'use strict';

const STATUS = Object.freeze({
  // General processing
  '001': 'STARTED',
  '002': 'PROCESSING',
  '003': 'COMPLETED',
  '004': 'FAILED',
  '005': 'PARTIALLY_COMPLETED',
  '006': 'SUCCESS',
  '007': 'PENDING',
  '008': 'CANCELLED',
  '009': 'RETRYING',
  '010': 'SKIPPED',
  // File
  '011': 'FILE_RECEIVED',
  '012': 'FILE_NOT_FOUND',
  '013': 'EMPTY_FILE',
  '014': 'INVALID_FILE_NAME',
  '015': 'DUPLICATE_FILE',
  '016': 'DUPLICATE_FILE_NAME',
  '017': 'CSV_HEADER_MISMATCH',
  '018': 'FILE_DOWNLOAD_FAILED',
  '019': 'FILE_MOVE_FAILED',
  '020': 'SFTP_CONNECTION_FAILED',
  // Master
  '021': 'ACTIVE',
  '022': 'INACTIVE',
  '023': 'VALIDATION_FAILED',
  '024': 'DUPLICATE_BP',
  '025': 'CROSS_COMPANY_DUPLICATE',
  '026': 'DUPLICATE_ID_IN_BATCH',
  '027': 'MISSING_REQUIRED_FIELD',
  '028': 'FIELD_LENGTH_EXCEEDED',
  '029': 'INVALID_TYPE',
  '030': 'INVALID_PORTAL',
  // Validation
  '031': 'INVALID_COMPANY',
  '032': 'INVALID_COUNTRY',
  '033': 'INVALID_AMOUNT',
  '034': 'INVALID_CURRENCY',
  '035': 'INVALID_PAYMENT_TYPE',
  '036': 'INVALID_PAYMENT_SUBTYPE',
  '037': 'INVALID_TRANSACTION_STATUS',
  '038': 'INVALID_DATE',
  '039': 'REFERENCE_TOO_LONG',
  '040': 'EXPONENTIAL_REFERENCE',
  // Transaction
  '041': 'TRANSACTION_SUCCESS',
  '042': 'TRANSACTION_FAILED',
  '043': 'TRANSACTION_PENDING',
  '044': 'TRANSACTION_RETURN',
  // Duplicate checks
  '045': 'DUPLICATE_MOBI_REFERENCE',
  '046': 'DUPLICATE_HOST_REFERENCE',
  '047': 'MOBI_REFERENCE_EXISTS',
  '048': 'HOST_REFERENCE_EXISTS',
  // Master validation
  '049': 'INVALID_MERCHANT',
  '050': 'INVALID_HOST',
  '051': 'INVALID_PORTAL_MASTER',
  '052': 'INVALID_COMPANY_PORTAL',
  // Consolidation
  '053': 'CONSOLIDATION_PENDING',
  '054': 'CONSOLIDATION_SUCCESS',
  '055': 'CONSOLIDATION_FAILED',
  '056': 'GL_ACCOUNT_MISSING',
  '057': 'MERCHANT_BP_MISSING',
  '058': 'HOST_BP_MISSING',
  '059': 'BP_MASTER_MISSING',
  // Posting
  '060': 'POSTING_PENDING',
  '061': 'POSTED',
  '062': 'POSTING_FAILED',
  // Master data lookup (unified, requirement change)
  '063': 'NO_MASTER_DATA_FOUND',
  // NEW: txn_paid_date consistency (2026-08-18)
  '064': 'INVALID_TXN_PAID_DATE',
  '065': 'INVALID_BALANCE_CHECK',
  '100': 'UNKNOWN_ERROR'
});

const FRIENDLY = Object.freeze({

  invalidFileName: (fileName, expected) =>
    `File name does not match the expected pattern. Received: "${fileName}". Expected format: ${expected}. Please rename the file to the correct pattern and re-upload.`,
  missingColumn: (missing) =>
    `CSV header is missing required column(s): ${missing.join(', ')}. Please ensure the CSV contains all mandatory columns before re-uploading.`,
  missingField: (field) =>
    `Mandatory field "${field}" is missing or blank. Please populate it and re-upload.`,
  fieldTooLong: (field, maxLen, actualLen) =>
    `Field "${field}" exceeds the maximum length of ${maxLen} characters (received ${actualLen} characters). Please shorten the value and re-upload.`,
  invalidType: (value, allowed) =>
    `Invalid merchant type "${value}". Allowed values: ${allowed.join(', ')}. Please correct the type and re-upload.`,
  invalidPortal: (value, allowed) =>
    `Invalid MOBI_PORTAL_CODE "${value}". Allowed values: ${allowed.join(', ')}. Please use a valid portal code and re-upload.`,
  invalidCompany: (value, allowed) =>
    `Invalid SAP_COMPANY_CODE "${value}". Allowed values: ${allowed.join(', ')}. Company code must be numeric; please correct and re-upload.`,
  invalidCountry: (value) =>
    `Invalid COUNTRY_CODE "${value}". Must be a valid 2-letter ISO country code (e.g. IN, SG, MY, ID, AE). Please correct and re-upload.`,
  duplicateIdInBatch: (id) =>
    `Duplicate ID "${id}" found within the same file. Each merchant/host must be unique per file. Please remove the duplicate and re-upload.`,
  invalidAmount: (value) =>
    `Invalid transaction amount "${value}". Amount must be a positive number greater than zero.`,
  invalidCurrency: (value) =>
    `Invalid currency "${value}". Currency must be a 3-letter ISO code (e.g. MYR, IDR, INR).`,
  invalidPaymentType: (value, allowed) =>
    `Unsupported payment type "${value}". Allowed values: ${allowed.join(', ')}.`,
  invalidPaymentSubType: (value, allowed) =>
    `Unsupported payment sub-type "${value}". Allowed values: ${allowed.join(', ')}.`,
  invalidTxnStatus: (value, allowed) =>
    `Unsupported transaction status "${value}". Allowed values: ${allowed.join(', ')}.`,
  invalidDate: (value) =>
    `Invalid date value "${value}". Accepted formats: DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, YYYY-MM-DD. Please correct the date and re-upload.`,
  refTooLong: (field, maxLen) =>
    `${field} exceeds ${maxLen} characters. Please shorten the reference ID.`,
  exponentialRef: (field, value) =>
    `${field} "${value}" must not be an exponential/scientific number. Please provide the full reference ID as text.`,
  duplicateMobiRef: (ref) =>
    `Duplicate MOBI_REFERENCE_ID "${ref}" in file. Each transaction reference must be unique.`,
  duplicateHostRef: (ref, date) =>
    `Duplicate HOST_REFERENCE_ID "${ref}" on transaction date ${date}. Host reference must be unique per day.`,
  duplicateMobiRefDb: (ref) =>
    `MOBI_REFERENCE_ID "${ref}" already exists in the database. Please use a unique reference ID.`,
  duplicateHostRefDb: (ref) =>
    `HOST_REFERENCE_ID "${ref}" already exists for the same transaction day in the database.`,
  // Requirement change: unified master-data lookup message. {value} is the
  // merchant id / host name / portal / company that could not be found.
  noMasterDataFound: (value) =>
    `No master data found "${value}"`,
  invalidMerchant: (id) =>
    `Merchant ID "${id}" is not active for the given portal/company combination. Please check master data or correct the ID.`,
  invalidHost: (host) =>
    `Host name "${host}" is not active for the given portal/company combination. Please check master data or correct the host name.`,
  invalidPortalMaster: (portal) =>
    `Portal code "${portal}" is not active in master data. Please configure the portal first.`,
  invalidCompanyPortal: (company, portal) =>
    `Company code "${company}" is not valid for portal "${portal}". Please verify the company/portal combination.`,
  fileMoveFailed: (from, to, reason) =>
    `Failed to move file from "${from}" to "${to}". Reason: ${reason}. Please check SFTP permissions/folder availability.`,
  fileDownloadFailed: (remotePath, reason) =>
    `Failed to download file "${remotePath}". Reason: ${reason}.`,
  sftpConnection: (reason) =>
    `SFTP connection failed: ${reason}. Please verify destination configuration.`,
  // NEW: txn_paid_date consistency
  invalidPaidDate: (distinctValues) => {
    const display = (distinctValues || []).map((v) => v ? `"${v}"` : '"(empty)"').join(', ');
    return `Inconsistent txn_paid_date values found: [${display}]. All rows in the file must have the same txn_paid_date. Please correct the file so that txn_paid_date is consistent and re-upload.`;
  },
  invalidBalanceCheck: (distinctValues) => {
    const display = (distinctValues || []).map((v) => {
      const s = String(v ?? '').trim();
      return s ? `"${s}"` : '"(empty)"';
    }).join(', ');
    return `Invalid balance_check value(s) found: [${display}]. Every row must have balance_check equal to 0 (for example 0 or 0.00). Blank, missing, or any non-zero value rejects the entire file. Please set balance_check to 0 on all rows and re-upload.`;
  }
});

function toText(code) {
  if (!code) return '';
  const normalized = String(code).trim().padStart(3, '0');
  return STATUS[normalized] || normalized;
}

function toCode(text, defaultCode = null) {
  if (!text) return defaultCode;
  const value = String(text).trim().toUpperCase();
  if (STATUS[value]) return value;
  for (const [code, description] of Object.entries(STATUS)) {
    if (description === value) return code;
  }
  return defaultCode;
}

function normalizeCode(value, defaultText = 'UNKNOWN_ERROR') {
  return toCode(value, toCode(defaultText, '100'));
}

function describe(value) {
  const code = normalizeCode(value);
  return { code, text: toText(code) };
}

/**
 * Canonical, fully-concatenated error detail for a record. Used by BOTH the
 * error text file and the audit so they always show the exact same string.
 * Format: "CODE1: message1 || CODE2: message2".
 */
function concatErrorDetail(errors) {
  if (!errors?.length) return '';
  return errors
    .map((error) => {
      const code = toText(normalizeCode(error.code));
      const message = String(error.message || '').replace(/[\r\n]+/g, ' ').trim();
      return `${code}: ${message}`;
    })
    .join(' || ');
}

/**
 * Resolve the canonical detail for an already-validated record. Prefers the
 * structured validation errors; falls back to STATUS_MESSAGE for file-level
 * errors (duplicate file name, invalid file name, hard failure) that have no
 * structured errors.
 */
function recordErrorDetail(record) {
  const errors = record?._VALIDATION_ERRORS || [];
  if (errors.length) return concatErrorDetail(errors);
  return String(record?.STATUS_MESSAGE || '').replace(/[\r\n]+/g, ' ').trim();
}

async function ensureStatusTable() {
  const cds = require('@sap/cds');
  const { INSERT } = cds.ql;
  try {
    const db = await cds.connect.to('db');
    const entries = Object.entries(STATUS).map(([STATUS_CODE, DESCRIPTION]) => ({
      STATUS_CODE,
      DESCRIPTION
    }));
    for (let index = 0; index < entries.length; index += 100) {
      const chunk = entries.slice(index, index + 100);
      try {
        await db.run(INSERT.into('mobi.db.MOBI_DB_STATUS').entries(chunk));
      } catch (err) {
        for (const row of chunk) {
          try { await db.run(INSERT.into('mobi.db.MOBI_DB_STATUS').entries(row)); }
          catch (_) { /* already exists */ }
        }
      }
    }
  } catch (err) {
    console.warn('[StatusCodeUtil] ensureStatusTable skipped:', err.message);
  }
}

// Kept for backward compatibility with any caller that used the [n] (code) format.
function joinErrorDetails(errors) {
  if (!errors?.length) return '';
  return errors
    .map((error, index) =>
      `[${index + 1}] (${normalizeCode(error.code)}) ${String(error.message || '').trim()}`)
    .join(' || ');
}

function joinErrorCodes(errors) {
  if (!errors?.length) return '';
  return [...new Set(errors.map((error) => normalizeCode(error.code)))].join(',');
}

module.exports = Object.freeze({
  STATUS,
  FRIENDLY,
  toText,
  toCode,
  normalizeCode,
  describe,
  concatErrorDetail,
  recordErrorDetail,
  ensureStatusTable,
  joinErrorDetails,
  joinErrorCodes
});
