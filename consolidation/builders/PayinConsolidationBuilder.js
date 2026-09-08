'use strict';

const BaseScenarioBuilder = require('./BaseScenarioBuilder');
const AmountUtil = require('../utils/AmountUtil');
const GroupUtil = require('../utils/GroupUtil');
const NormalizeUtil = require('../utils/NormalizeUtil');
const Constants = require('../constants/ConsolidationConstants');

class PayinConsolidationBuilder extends BaseScenarioBuilder {
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

      for (const hostRows of hostGroups.values()) {
        const amount = AmountUtil.sum(hostRows, 'HOST_MDR_AMOUNT');
        if (!AmountUtil.isNonZero(amount)) continue;
        const base = hostRows[0];
        lineItems.push(this.createLineItem({
          consolRefId, sapRefDocument, docRefItem: docRefItem++, baseRecord: base, amount,
          amountField: 'HOST_MDR_AMOUNT', debitCredit: Constants.DEBIT_CREDIT.DEBIT,
          glAccount: context.resolveGlAccount(base, 'HOST_MDR_AMOUNT'),
          merchantId: '', hostName: base.HOST_NAME, options
        }));
      }

      for (const hostRows of hostGroups.values()) {
        const amount = AmountUtil.sum(hostRows, 'AR_PAYIN');
        if (!AmountUtil.isNonZero(amount)) continue;
        const base = hostRows[0];
        const hostBp = context.resolveHostCustomerBp(base, this.scenario);
        lineItems.push(this.createLineItem({
          consolRefId, sapRefDocument, docRefItem: docRefItem++, baseRecord: base, amount,
          amountField: 'AR_PAYIN', debitCredit: Constants.DEBIT_CREDIT.DEBIT,
          customerNumber: hostBp.bpNumber,
          merchantId: '', hostName: hostBp.externalBpNumber, options
        }));
      }

      for (const hostRows of hostGroups.values()) {
        const amount = AmountUtil.sum(hostRows, 'MDR_REVENUE');
        if (!AmountUtil.isNonZero(amount)) continue;
        const base = hostRows[0];
        lineItems.push(this.createLineItem({
          consolRefId, sapRefDocument, docRefItem: docRefItem++, baseRecord: base, amount,
          amountField: 'MDR_REVENUE', debitCredit: Constants.DEBIT_CREDIT.CREDIT,
          glAccount: context.resolveGlAccount(base, 'MDR_REVENUE'),
          merchantId: '', hostName: base.HOST_NAME, options
        }));
      }

      const merchantGroups = GroupUtil.by(groupRows, (r) => NormalizeUtil.text(r.MERCHANT_ID));

      for (const merchantRows of merchantGroups.values()) {
        const amount = AmountUtil.sum(merchantRows, 'AP_PAYIN');
        if (!AmountUtil.isNonZero(amount)) continue;
        const base = merchantRows[0];
        const mb = context.resolveMerchantBp(base, this.scenario);
        lineItems.push(this.createLineItem({
          consolRefId, sapRefDocument, docRefItem: docRefItem++, baseRecord: base, amount,
          amountField: 'AP_PAYIN', debitCredit: Constants.DEBIT_CREDIT.CREDIT,
          supplierNumber: mb.bpNumber,
          merchantId: mb.externalBpNumber, hostName: '', options
        }));
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

module.exports = PayinConsolidationBuilder;
