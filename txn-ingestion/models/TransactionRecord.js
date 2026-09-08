'use strict';

const DateUtil = require('../utils/DateUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

function toNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  const number = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(number) ? number : Number.NaN;
}

class TransactionRecord {
  static fromCsvRow(row, auditId) {
    const createdDate = DateUtil.parseCsvDate(row.txn_created_date, { required: true });
    const paidDate = DateUtil.parseCsvDate(row.txn_paid_date, { required: false });
    const createdTime = DateUtil.parseCsvTime(row.txn_time_created);
    const paidTime = DateUtil.parseCsvTime(row.txn_time_paid);

    const dateErrors = [createdDate.error, paidDate.error].filter(Boolean);

    if (String(row.txn_time_created || '').trim() && !createdTime) {
      dateErrors.push(`INVALID_TIME: ${row.txn_time_created}`);
    }

    if (String(row.txn_time_paid || '').trim() && !paidTime) {
      dateErrors.push(`INVALID_TIME: ${row.txn_time_paid}`);
    }

    // Extract raw string for strict validation
    // Distinguishes empty from user-entered 0
    const balanceCheckRaw = String(row.balance_check || '').trim();
    const balanceCheckNum = balanceCheckRaw
      ? Number(balanceCheckRaw.replace(/,/g, ''))
      : 0;

    return {
      _RAW_ROW: { ...row },
      _DATE_ERRORS: dateErrors,

      COMPANY_CODE: String(row.sap_company_code || '').trim(),
      MOBI_REFERENCE_ID: String(row.mobi_reference_id || '').trim(),
      PAYMENT_TYPE: String(row.payment_type || '').trim(),
      AUDIT_ID: auditId,
      MOBI_PORTAL_CODE: String(row.mobi_portal_code || '').trim(),
      MERCHANT_ID: String(row.merchant_id || '').trim(),
      MERCHANT_TYPE: String(row.merchant_type || '').trim(),
      MERCHANT_NAME: String(row.merchant_name || '').trim(),

      TXN_CREATED_DATE: createdDate.iso,
      TXN_PAID_DATE: paidDate.iso || undefined,
      TXN_CREATED_TIME: createdTime || undefined,
      TXN_PAID_TIME: paidTime || undefined,

      TIME_ZONE: String(row.time_zone || '').trim(),
      PAYMENT_SUB_TYPE: String(row.payment_sub_type || '').trim(),
      PAYMENT_METHOD: String(row.payment_method || '').trim(),
      HOST_NAME: String(row.host_name || '').trim(),
      TXN_CURRENCY: String(row.transaction_currency || '').trim().toUpperCase(),

      TXN_AMOUNT: toNumber(row.transaction_amount),
      HOST_MDR_AMOUNT: toNumber(row.host_mdr_amount),
      HOST_FEE_PAYABLE: toNumber(row.host_fee_payable),
      MOBI_MDR_AMOUNT: toNumber(row.mobi_mdr_amount),
      MDR_REVENUE: toNumber(row.mdr_revenue),
      AR_PAYIN: toNumber(row.ar_payin),
      AP_PAYIN: toNumber(row.ap_payin),
      AP_PAYOUT: toNumber(row.ap_payout),

      HOST_REFERENCE_ID: String(row.host_reference_id || '').trim(),
      MERCHANT_REFERENCE_ID: String(row.merchant_reference_id || '').trim(),
      TXN_STATUS: String(row.transaction_status || '').trim().toUpperCase(),
      ORIGINAL_AMOUNT: toNumber(row.original_amount),
      SETTLED_IN_CURRENCY: String(row.settled_in_currency || '').trim().toUpperCase(),
      CONVERSION_RATE: toNumber(row.conversion_rate),

      COUNTRY_CODE: '',
      CONSOL_STATUS: StatusCodeUtil.toText(StatusCodeUtil.toCode('PENDING')),
      CONSOL_REF_ID: '',

      // Parsed number for DB
      BALANCE_CHECK: balanceCheckNum,

      // Raw value for strict validation
      _BALANCE_CHECK_RAW: balanceCheckRaw,

      ROW_STATUS: '',
      STATUS_CODE: dateErrors.length
        ? StatusCodeUtil.toCode('INVALID_DATE')
        : '',
      STATUS_MESSAGE: dateErrors.join(' || ')
    };
  }
}

module.exports = TransactionRecord;