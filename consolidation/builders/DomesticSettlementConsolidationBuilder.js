'use strict';

const BaseScenarioBuilder = require('./BaseScenarioBuilder');
const AmountUtil = require('../utils/AmountUtil');
const GroupUtil = require('../utils/GroupUtil');
const NormalizeUtil = require('../utils/NormalizeUtil');
const Constants = require('../constants/ConsolidationConstants');

class DomesticSettlementConsolidationBuilder extends BaseScenarioBuilder {
  async buildDocuments(records, options, context) {
    const dailyGroups = GroupUtil.by(records, (r) => [
      this.getCompanyCode(r),
      this.getPortalCode(r),
      this.getPostingDate(r, options),
      NormalizeUtil.upper(r.TXN_CURRENCY)
    ].join('|'));

    const documents = [];
    const unbalanced = [];

    for (const groupRows of dailyGroups.values()) {
      const first = groupRows[0];
      const companyCode = this.getCompanyCode(first);
      const postingDate = this.getPostingDate(first, options);

      const consolRefId = await context.referenceNumberService.nextConsolRefId(
        this.scenario,
        companyCode,
        postingDate
      );
      const sapRefDocument = '';

      const lineItems = [];
      let docRefItem = 1;

      const hostGroups = GroupUtil.by(
        groupRows,
        (r) => NormalizeUtil.host(r.HOST_NAME)
      );

      const merchantGroups = GroupUtil.by(
        groupRows,
        (r) => NormalizeUtil.text(r.MERCHANT_ID)
      );

      const hostCustomerCache = new Map();

      const resolveHostCustomer = (record) => {
        const cacheKey = [
          this.getCompanyCode(record),
          this.getPortalCode(record),
          NormalizeUtil.host(record.HOST_NAME)
        ].join('|');

        if (!hostCustomerCache.has(cacheKey)) {
          const hb = context.resolveHostCustomerBp(record, this.scenario);

          hostCustomerCache.set(cacheKey, {
            customerNumber: hb?.bpNumber || null,
            hostName: hb?.externalBpNumber || NormalizeUtil.text(record.HOST_NAME)
          });
        }

        return hostCustomerCache.get(cacheKey);
      };

      const settlementAmount = (r) => {
        const primaryField = this.scenario.amountField || 'AP_PAYOUT';
        const fallbackField = this.scenario.fallbackAmountField;

        // Strict mode: when no fallback is configured, merchant lines use the
        // primary field (TXN_AMOUNT) as-is; zero amounts are skipped by the
        // callers below (isNonZero check).
        if (!fallbackField) return r[primaryField];

        return AmountUtil.isNonZero(r[primaryField])
          ? r[primaryField]
          : r[fallbackField];
      };

      /**
       * Line 1 style:
       * Clearing debit for merchant payout total (amount = TXN_AMOUNT).
       * Stored in the AP_PAYOUT column as the debit (S) "total" line.
       *
       * Example:
       * Dr 48638.89 GL 17001000 Host MAYBANK / 4580001
       */
      const addClearingDebit = () => {
        for (const hostRows of hostGroups.values()) {
          const amount = AmountUtil.sumBy(hostRows, settlementAmount);
          if (!AmountUtil.isNonZero(amount)) continue;

          const base = hostRows[0];
          const hc = resolveHostCustomer(base);
          const gl = context.resolveGlAccount(
            base,
            this.scenario.clearingGlFlagField || 'TXN_AMOUNT'
          );

          if (!gl) continue;

          lineItems.push(
            this.createLineItem({
              consolRefId,
              sapRefDocument,
              docRefItem: docRefItem++,
              baseRecord: base,
              amount,
              amountField: this.scenario.clearingAmountField || 'AP_PAYOUT',
              debitCredit: Constants.DEBIT_CREDIT.DEBIT,
              glAccount: gl,
              customerNumber: hc.customerNumber,
              merchantId: null,
              hostName: hc.hostName,
              options
            })
          );
        }
      };

      /**
       * Line 2 style:
       * Host MDR cost debit.
       *
       * Example:
       * Dr 10.80 GL 41001400 Host MAYBANK / 4580001
       */
      const addHostCostDebit = () => {
        for (const hostRows of hostGroups.values()) {
          const amount = AmountUtil.sum(hostRows, 'HOST_MDR_AMOUNT');
          if (!AmountUtil.isNonZero(amount)) continue;

          const base = hostRows[0];
          const hc = resolveHostCustomer(base);
          const gl = context.resolveGlAccount(base, 'HOST_MDR_AMOUNT');

          if (!gl) continue;

          lineItems.push(
            this.createLineItem({
              consolRefId,
              sapRefDocument,
              docRefItem: docRefItem++,
              baseRecord: base,
              amount,
              amountField: 'HOST_MDR_AMOUNT',
              debitCredit: Constants.DEBIT_CREDIT.DEBIT,
              glAccount: gl,
              customerNumber: hc.customerNumber,
              merchantId: null,
              hostName: hc.hostName,
              options
            })
          );
        }
      };

      /**
       * Lines 3..n style:
       * Merchant AP payout credit lines (amount = TXN_AMOUNT).
       * Stored in the TRANSACTION_AMOUNT column as the credit (H)
       * "merchant supplier" line.
       *
       * Example:
       * Cr merchant amount, supplier number, no GL.
       */
      const addMerchantApPayoutCredit = () => {
        for (const merchantRows of merchantGroups.values()) {
          const amount = AmountUtil.sumBy(merchantRows, settlementAmount);
          if (!AmountUtil.isNonZero(amount)) continue;

          const base = merchantRows[0];
          const merchant = context.resolveMerchantBp(base, this.scenario);

          const supplierNumber =
            merchant && typeof merchant === 'object'
              ? merchant.bpNumber
              : merchant;

          const merchantId =
            (merchant && typeof merchant === 'object' && merchant.externalBpNumber) ||
            NormalizeUtil.text(base.MERCHANT_ID);

          lineItems.push(
            this.createLineItem({
              consolRefId,
              sapRefDocument,
              docRefItem: docRefItem++,
              baseRecord: base,
              amount,
              amountField:
                this.scenario.merchantAmountField ||
                this.scenario.amountField ||
                'AP_PAYOUT',
              debitCredit: Constants.DEBIT_CREDIT.CREDIT,
              glAccount: null,
              supplierNumber,
              merchantId,
              hostName: null,
              options
            })
          );
        }
      };

      /**
       * Final line style:
       * Host fee payable credit.
       *
       * Example:
       * Cr 10.80 GL 15002200 Host MAYBANK / 4580001
       */
      const addHostFeePayableCredit = () => {
        for (const hostRows of hostGroups.values()) {
          const amount = AmountUtil.sumBy(hostRows, (r) =>
            AmountUtil.isNonZero(r.HOST_FEE_PAYABLE)
              ? r.HOST_FEE_PAYABLE
              : r.HOST_MDR_AMOUNT
          );

          if (!AmountUtil.isNonZero(amount)) continue;

          const base = hostRows[0];
          const hc = resolveHostCustomer(base);
          const gl = context.resolveGlAccount(base, 'HOST_FEE_PAYABLE');

          if (!gl) continue;

          lineItems.push(
            this.createLineItem({
              consolRefId,
              sapRefDocument,
              docRefItem: docRefItem++,
              baseRecord: base,
              amount,
              amountField: 'HOST_FEE_PAYABLE',
              debitCredit: Constants.DEBIT_CREDIT.CREDIT,
              glAccount: gl,
              customerNumber: hc.customerNumber,
              merchantId: null,
              hostName: hc.hostName,
              options
            })
          );
        }
      };

      const blockHandlers = {
        CLEARING_DEBIT: addClearingDebit,
        HOST_COST_DEBIT: addHostCostDebit,
        MERCHANT_AP_PAYOUT_CREDIT: addMerchantApPayoutCredit,
        HOST_FEE_PAYABLE_CREDIT: addHostFeePayableCredit
      };

      const blockOrder =
        this.scenario.domesticLineBlockOrder ||
        this.scenario.lineBlockOrder ||
        [
          'CLEARING_DEBIT',
          'HOST_COST_DEBIT',
          'MERCHANT_AP_PAYOUT_CREDIT',
          'HOST_FEE_PAYABLE_CREDIT'
        ];

      for (const block of blockOrder) {
        const handler = blockHandlers[block];
        if (!handler) {
          throw new Error(`Unsupported domestic settlement line block ${block}`);
        }
        handler();
      }

      const totals = this.totalsFromLineItems(lineItems);

      const header = this.createHeader({
        consolRefId,
        sapRefDocument,
        groupRows,
        totals,
        options
      });

      const document = {
        header,
        lineItems,
        sourceTransactions: groupRows
      };

      if (this.isBalanced(document)) {
        documents.push(document);
      } else {
        unbalanced.push(document);
      }
    }

    return { documents, unbalanced };
  }
}

module.exports = DomesticSettlementConsolidationBuilder;
