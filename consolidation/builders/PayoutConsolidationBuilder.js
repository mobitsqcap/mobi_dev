'use strict';

const BaseScenarioBuilder = require('./BaseScenarioBuilder');
const AmountUtil = require('../utils/AmountUtil');
const GroupUtil = require('../utils/GroupUtil');
const NormalizeUtil = require('../utils/NormalizeUtil');
const Constants = require('../constants/ConsolidationConstants');

class PayoutConsolidationBuilder extends BaseScenarioBuilder {
  async buildDocuments(records, options, context) {
    const dailyGroups = GroupUtil.by(records, (r) => [
      this.getCompanyCode(r), this.getPortalCode(r),
      this.getPostingDate(r, options), NormalizeUtil.upper(r.TXN_CURRENCY)
    ].join('|'));

    const documents = [];
    const unbalanced = [];

    for (const groupRows of dailyGroups.values()) {
      const first = groupRows[0];
      const companyCode = this.getCompanyCode(first);
      const postingDate = this.getPostingDate(first, options);

      const consolRefId = await context.referenceNumberService.nextConsolRefId(this.scenario, companyCode, postingDate);
      const sapRefDocument = '';
      const lineItems = [];
      let docRefItem = 1;

      const hostGroups = GroupUtil.by(groupRows, (r) => NormalizeUtil.host(r.HOST_NAME));
      const merchantGroups = GroupUtil.by(groupRows, (r) => NormalizeUtil.text(r.MERCHANT_ID));

      const hostCustomerCache = new Map();
      const resolveHostCustomer = (record) => {
        const cacheKey = [
          this.getCompanyCode(record), this.getPortalCode(record),
          NormalizeUtil.host(record.HOST_NAME)
        ].join('|');
        if (!hostCustomerCache.has(cacheKey)) {
          const hb = context.resolveHostCustomerBp(record, this.scenario);
          hostCustomerCache.set(cacheKey, {
            customerNumber: hb.bpNumber,
            hostName: hb.externalBpNumber
          });
        }
        return hostCustomerCache.get(cacheKey);
      };

      const addHostCost = () => {
        for (const hostRows of hostGroups.values()) {
          const amount = AmountUtil.sum(hostRows, 'HOST_MDR_AMOUNT');
          if (!AmountUtil.isNonZero(amount)) continue;
          const base = hostRows[0];
          const hc = resolveHostCustomer(base);
          const gl = context.resolveGlAccount(base, 'HOST_MDR_AMOUNT');
          if (!gl) continue;
          lineItems.push(this.createLineItem({
            consolRefId, sapRefDocument, docRefItem: docRefItem++, baseRecord: base, amount,
            amountField: 'HOST_MDR_AMOUNT', debitCredit: Constants.DEBIT_CREDIT.DEBIT,
            glAccount: gl,
            customerNumber: hc.customerNumber, merchantId: null, hostName: hc.hostName, options
          }));
        }
      };

      const addMerchantApPayout = () => {
        for (const merchRows of merchantGroups.values()) {
          const amount = AmountUtil.sum(merchRows, 'AP_PAYOUT');
          if (!AmountUtil.isNonZero(amount)) continue;
          const base = merchRows[0];
          const m = context.resolveMerchantBp(base, this.scenario);
          const supplierNumber = (m && typeof m === 'object') ? m.bpNumber : m;
          lineItems.push(this.createLineItem({
            consolRefId, sapRefDocument, docRefItem: docRefItem++, baseRecord: base, amount,
            amountField: 'AP_PAYOUT', debitCredit: Constants.DEBIT_CREDIT.DEBIT,
            supplierNumber, merchantId: base.MERCHANT_ID, hostName: null, options
          }));
        }
      };

      const addHostMdrRevenue = () => {
        for (const hostRows of hostGroups.values()) {
          const amount = AmountUtil.sum(hostRows, 'MDR_REVENUE');
          if (!AmountUtil.isNonZero(amount)) continue;
          const base = hostRows[0];
          const hc = resolveHostCustomer(base);
          const gl = context.resolveGlAccount(base, 'MDR_REVENUE');
          if (!gl) continue;
          lineItems.push(this.createLineItem({
            consolRefId, sapRefDocument, docRefItem: docRefItem++, baseRecord: base, amount,
            amountField: 'MDR_REVENUE', debitCredit: Constants.DEBIT_CREDIT.CREDIT,
            glAccount: gl,
            customerNumber: hc.customerNumber, merchantId: null, hostName: hc.hostName, options
          }));
        }
      };

      const addHostFeePayable = () => {
        for (const hostRows of hostGroups.values()) {
          const amount = AmountUtil.sumBy(hostRows, (r) =>
            AmountUtil.isNonZero(r.HOST_FEE_PAYABLE) ? r.HOST_FEE_PAYABLE : r.HOST_MDR_AMOUNT);
          if (!AmountUtil.isNonZero(amount)) continue;
          const base = hostRows[0];
          const hc = resolveHostCustomer(base);
          const gl = context.resolveGlAccount(base, 'HOST_FEE_PAYABLE');
          if (!gl) continue;
          lineItems.push(this.createLineItem({
            consolRefId, sapRefDocument, docRefItem: docRefItem++, baseRecord: base, amount,
            amountField: 'HOST_FEE_PAYABLE', debitCredit: Constants.DEBIT_CREDIT.CREDIT,
            glAccount: gl,
            customerNumber: hc.customerNumber, merchantId: null, hostName: hc.hostName, options
          }));
        }
      };

      const addClearPayout = () => {
        for (const hostRows of hostGroups.values()) {
          const amount = AmountUtil.sum(hostRows, 'TXN_AMOUNT');
          if (!AmountUtil.isNonZero(amount)) continue;
          const base = hostRows[0];
          const hc = resolveHostCustomer(base);
          const gl = context.resolveGlAccount(base, 'TXN_AMOUNT');
          if (!gl) continue;
          lineItems.push(this.createLineItem({
            consolRefId, sapRefDocument, docRefItem: docRefItem++, baseRecord: base, amount,
            amountField: 'TRANSACTION_AMOUNT', debitCredit: Constants.DEBIT_CREDIT.CREDIT,
            glAccount: gl,
            customerNumber: hc.customerNumber, merchantId: null, hostName: hc.hostName, options
          }));
        }
      };

      const blockHandlers = {
        HOST_COST: addHostCost,
        MERCHANT_AP_PAYOUT: addMerchantApPayout,
        HOST_MDR_REVENUE: addHostMdrRevenue,
        HOST_FEE_PAYABLE: addHostFeePayable,
        CLEAR_PAYOUT: addClearPayout
      };

      const blockOrder = this.scenario.lineBlockOrder
        || ['HOST_COST', 'MERCHANT_AP_PAYOUT', 'HOST_MDR_REVENUE', 'HOST_FEE_PAYABLE', 'CLEAR_PAYOUT'];

      for (const block of blockOrder) {
        const h = blockHandlers[block];
        if (!h) throw new Error(`Unsupported payout line block ${block}`);
        h();
      }

      const totals = this.totalsFromLineItems(lineItems);
      const header = this.createHeader({ consolRefId, sapRefDocument, groupRows, totals, options });
      const document = { header, lineItems, sourceTransactions: groupRows };

      if (this.isBalanced(document)) {
        documents.push(document);
      } else {
        unbalanced.push(document);
      }
    }

    return { documents, unbalanced };
  }
}

module.exports = PayoutConsolidationBuilder;
