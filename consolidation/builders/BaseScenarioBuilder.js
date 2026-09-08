'use strict';

const AmountUtil = require('../utils/AmountUtil');
const DateUtil = require('../utils/DateUtil');
const NormalizeUtil = require('../utils/NormalizeUtil');
const Constants = require('../constants/ConsolidationConstants');

const LINE_AMOUNT_FIELDS = Object.freeze([
  'HOST_MDR_AMOUNT', 'HOST_FEE_PAYABLE', 'MDR_REVENUE',
  'AR_PAYIN', 'AP_PAYIN', 'AP_PAYOUT', 'TRANSACTION_AMOUNT'
]);

class BaseScenarioBuilder {
  constructor(scenario) { this.scenario = scenario; }

  async buildDocuments() {
    throw new Error('buildDocuments must be implemented by scenario builder');
  }

  getCompanyCode(record) { return NormalizeUtil.text(record.COMPANY_CODE); }
  getPortalCode(record) { return NormalizeUtil.text(record.MOBI_PORTAL_CODE); }

  getPostingDate(record, options = {}) { return DateUtil.dbDate(options.postingDate || record.TXN_PAID_DATE); }
  getDocumentDate(record, options = {}) { return DateUtil.dbDate(options.documentDate || this.getPostingDate(record, options)); }
  getBaselineDate(record, options = {}) { return DateUtil.dbDate(options.baselineDate || this.getPostingDate(record, options)); }

  getCostCenter(companyCode) { return this.scenario.costCenterByCompany?.[companyCode] || null; }
  getProfitCenter(companyCode) { return this.scenario.profitCenterByCompany?.[companyCode] || null; }

  getOutputPaymentType(record) { return this.scenario.outputPaymentType || record.PAYMENT_TYPE || this.scenario.code; }
  getOutputPaymentSubType(record) { return this.scenario.outputPaymentSubType || record.PAYMENT_SUB_TYPE || null; }

  // Point 6: documents pushed to header/line items start at 060 POSTING_PENDING.
  // CPI later flips them to 061 POSTED or 062 POSTING_FAILED.
  // Fallback '060' guards against a stale/missing constant so STATUS_CODE is never null.
  get initialStatusCode() { return Constants.POSTING_STATUS.POSTING_PENDING || '060'; }

  createHeader({ consolRefId, sapRefDocument, groupRows, totals, options = {} }) {
    const first = groupRows[0];
    const postingDate = this.getPostingDate(first, options);
    const now = options.now || DateUtil.nowTimestamp();
    const user = options.requestedBy || Constants.SYSTEM_USER;

    return {
      CONSOL_REF_ID: consolRefId,
      SAP_REF_DOCUMENT: sapRefDocument,
      COMPANY_CODE: this.getCompanyCode(first),
      MOBI_PORTAL_CODE: this.getPortalCode(first),
      PAYMENT_TYPE: this.getOutputPaymentType(first),
      PAYMENT_SUB_TYPE: this.getOutputPaymentSubType(first),
      DOCUMENT_TYPE: this.scenario.documentType,
      POSTING_DATE: postingDate,
      DOCUMENT_DATE: this.getDocumentDate(first, options),
      BASELINE_DATE: this.getBaselineDate(first, options),
      TOTAL_DEBIT_AMOUNT: AmountUtil.round2(totals.debit),
      TOTAL_CREDIT_AMOUNT: AmountUtil.round2(totals.credit),
      CURRENCY: NormalizeUtil.upper(first.TXN_CURRENCY),
      STATUS_CODE: this.initialStatusCode,
      POST_DATE: null,
      HTTP_STATUS: null,
      RETRY_COUNT: 0,
      CREATED_BY: user,
      CREATED_TIMESTAMP: now,
      CHANGED_BY: null,
      CHANGED_TIMESTAMP: null
    };
  }

  createLineItem({
    consolRefId, sapRefDocument, docRefItem, baseRecord, amount, amountField,
    debitCredit, glAccount = null, supplierNumber = null, customerNumber = null,
    merchantId = undefined, hostName = undefined, options = {}
  }) {
    const companyCode = this.getCompanyCode(baseRecord);
    const postingDate = this.getPostingDate(baseRecord, options);
    const now = options.now || DateUtil.nowTimestamp();
    const user = options.requestedBy || Constants.SYSTEM_USER;

    const lineAmount = AmountUtil.round2(amount);

    const resolvedMerchantId = merchantId !== undefined
      ? merchantId
      : (NormalizeUtil.text(baseRecord.MERCHANT_ID) || null);

    const resolvedHostName = hostName !== undefined
      ? hostName
      : (NormalizeUtil.text(baseRecord.HOST_NAME) || null);

    const line = {
      CONSOL_REF_ID: consolRefId,
      DOC_REF_ITEM: docRefItem,
      SAP_REF_DOCUMENT: sapRefDocument,
      COMPANY_CODE: companyCode,
      MOBI_PORTAL_CODE: this.getPortalCode(baseRecord),
      PAYMENT_TYPE: this.getOutputPaymentType(baseRecord),
      PAYMENT_SUB_TYPE: this.getOutputPaymentSubType(baseRecord),
      MERCHANT_ID: resolvedMerchantId || null,
      SAP_SUPPLIER_NUMBER: supplierNumber || null,
      SAP_CUSTOMER_NUMBER: customerNumber || null,
      POSTING_DATE: postingDate,
      DOCUMENT_DATE: this.getDocumentDate(baseRecord, options),
      BASELINE_DATE: this.getBaselineDate(baseRecord, options),
      HOST_NAME: resolvedHostName || null,
      CURRENCY: NormalizeUtil.upper(baseRecord.TXN_CURRENCY),
      HOST_MDR_AMOUNT: null,
      HOST_FEE_PAYABLE: null,
      MDR_REVENUE: null,
      AR_PAYIN: null,
      AP_PAYIN: null,
      AP_PAYOUT: null,
      TRANSACTION_AMOUNT: null,
      GL_ACCOUNT: glAccount || null,
      DEBIT_CREDIT_INDICATOR: debitCredit,
      COST_CENTER: this.getCostCenter(companyCode),
      PROFIT_CENTER: this.getProfitCenter(companyCode),
      DOCUMENT_TYPE: this.scenario.documentType,
      STATUS_CODE: this.initialStatusCode,
      POST_DATE: null,
      HTTP_STATUS: null,
      RETRY_COUNT: 0,
      CREATED_BY: user,
      CREATED_TIMESTAMP: now,
      CHANGED_BY: null,
      CHANGED_TIMESTAMP: null
    };

    if (!amountField || !Object.prototype.hasOwnProperty.call(line, amountField)) {
      throw new Error(`Invalid consolidation line amount field ${amountField}`);
    }

    line[amountField] = lineAmount;
    return line;
  }

  totalsFromLineItems(lineItems) {
    let debitCents = 0, creditCents = 0;
    for (const line of lineItems || []) {
      const amt = this._lineAmount(line);
      if (line.DEBIT_CREDIT_INDICATOR === Constants.DEBIT_CREDIT.DEBIT) {
        debitCents += AmountUtil.toCents(amt);
      } else if (line.DEBIT_CREDIT_INDICATOR === Constants.DEBIT_CREDIT.CREDIT) {
        creditCents += AmountUtil.toCents(amt);
      }
    }
    return { debit: AmountUtil.fromCents(debitCents), credit: AmountUtil.fromCents(creditCents) };
  }

  _lineAmount(line) {
    return AmountUtil.sumBy(LINE_AMOUNT_FIELDS, (field) => line[field]);
  }

  // Point 5: documents whose debit != credit are not consolidated. Returns a
  // boolean (no throw) so the service can route them to the error flow like GL/BP.
  isBalanced(document) {
    const debit = AmountUtil.toCents(document.header.TOTAL_DEBIT_AMOUNT);
    const credit = AmountUtil.toCents(document.header.TOTAL_CREDIT_AMOUNT);
    return debit === credit;
  }

  imbalanceDetail(document) {
    return `Consolidation document ${document.header.CONSOL_REF_ID} not balanced: ` +
      `debit ${document.header.TOTAL_DEBIT_AMOUNT}, credit ${document.header.TOTAL_CREDIT_AMOUNT}`;
  }
}

module.exports = BaseScenarioBuilder;
