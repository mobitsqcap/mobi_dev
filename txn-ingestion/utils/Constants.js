'use strict';

const transactionPattern = process.env.TRANSACTION_FILE_PATTERN || '^Transactions_\\d{8}\\.csv$';
const transactionRetryPattern = process.env.TRANSACTION_RETRY_FILE_PATTERN || '^Transactions_\\d{8}_Updated\\.csv$';

const aliases = (...values) => new Set(values.map((v) => String(v).trim().toUpperCase()));
const TRANSACTION_ROOT = 'Transaction_Data';

module.exports = Object.freeze({
  BATCH_SIZE: Number(process.env.BATCH_SIZE || 2000),
  ACTIVE_FLAG: process.env.ACTIVE_FLAG || 'X',
  MAX_REF_ID_LENGTH: 100,

  ALLOWED_COMPANY_CODES: Object.freeze(new Set(['1000', '2000', '3000', '4000', '5000'])),
  VALID_PORTAL_CODES: Object.freeze(new Set(['SG', 'MY', 'IN', 'ID', 'AE'])),

  PAYMENT: {
    PAYIN_TYPE_ALIASES: aliases('PAYIN', 'PAYINS'),
    PAYOUT_TYPE_ALIASES: aliases('PAYOUT', 'PAYOUTS'),
    PAYIN_SUBTYPE_ALIASES: aliases('PAYIN', 'PAYINS'),
    PAYOUT_SUBTYPE_ALIASES: aliases('NORMAL'),
    DS_SUBTYPE_ALIASES: aliases('DOMESTIC SETTLEMENT', 'DOMESTIC_SETTLEMENT', 'DOMESTICSETTLEMENT', 'DS')
  },

  SFTP: {
    TRANSACTION: {
      ROOT_PATH: TRANSACTION_ROOT,
      FILEIN_PATH: `${TRANSACTION_ROOT}/FILE_IN`,
      PROCESSING_PATH: `${TRANSACTION_ROOT}/PROCESSING`,
      ERROR_PATH: `${TRANSACTION_ROOT}/ERROR`,
      PROCESSED_PATH: `${TRANSACTION_ROOT}/FILE_OUT`
    }
  },

  FILES: {
    TRANSACTION_REGEX: new RegExp(transactionPattern, 'i'),
    TRANSACTION_RETRY_REGEX: new RegExp(transactionRetryPattern, 'i')
  },

  ROW_STATUS: Object.freeze({ VALID: 'VALID', INVALID: 'INVALID' }),

  SYSTEM_USERS: Object.freeze({ DEFAULT: 'SYSTEM_SFTP', SFTP: 'SYSTEM_SFTP', CPI: 'SYSTEM_CPI' }),

  OUTPUT_NAMING: {
    FULL_SUCCESS: (date8, hhmmss) => `Transactions_${date8}_${hhmmss}.csv`
  },

  ERROR_NAMING: {
    FAILED_CSV: (date8) => `Transactions_${date8}_ERRORS.csv`,
    ERROR_TEXT: (date8) => `Transactions_${date8}_text.file`
  },

  RETRY: {
    ORIGINAL_FROM_ERROR_FILE: (fileName) =>
      String(fileName || '').replace(/_(ERRORS|Updated)\.csv$/i, '.csv')
  },

  TRANSACTION_CSV_COLUMNS: Object.freeze([
    'mobi_portal_code', 'sap_company_code', 'payment_type', 'payment_sub_type',
    'mobi_reference_id', 'merchant_id', 'merchant_type', 'merchant_name',
    'txn_created_date', 'txn_paid_date', 'txn_time_created', 'txn_time_paid',
    'payment_method', 'host_name', 'transaction_amount', 'host_mdr_amount',
    'host_fee_payable', 'mobi_mdr_amount', 'mdr_revenue', 'ar_payin', 'ap_payin',
    'ap_payout', 'host_reference_id', 'merchant_reference_id', 'transaction_status',
    'original_amount', 'transaction_currency', 'settled_in_currency', 'time_zone',
    'conversion_rate', 'balance_check'
  ])
});

