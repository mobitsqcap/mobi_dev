'use strict';

// Compatibility adapter for any existing DB/bootstrap import.
module.exports = require('../shared/utils/StatusCodeUtil').forProfile('db');

















// /**
//  * StatusCodeUtil – Shared status/error code mapping backed by MOBI_DB_STATUS.
//  *
//  * Design:
//  *  - MOBI_DB_STATUS contains only STATUS_CODE and DESCRIPTION.
//  *  - All modules use the same global 3-digit status codes.
//  *  - AUDIT stores STATUS_CODE only.
//  *  - FRIENDLY messages provide detailed user-readable explanations.
//  */
// const cds = require('@sap/cds');
// const { INSERT } = cds.ql;

// /* ------------------------------------------------------------------ */
// /* Global Status Codes                                                */
// /* ------------------------------------------------------------------ */
// const STATUS = Object.freeze({
//   // General Processing
//   '001': 'STARTED',
//   '002': 'PROCESSING',
//   '003': 'COMPLETED',
//   '004': 'FAILED',
//   '005': 'PARTIALLY_COMPLETED',
//   '006': 'SUCCESS',
//   '007': 'PENDING',
//   '008': 'CANCELLED',
//   '009': 'RETRYING',
//   '010': 'SKIPPED',
//   // File
//   '011': 'FILE_RECEIVED',
//   '012': 'FILE_NOT_FOUND',
//   '013': 'EMPTY_FILE',
//   '014': 'INVALID_FILE_NAME',
//   '015': 'DUPLICATE_FILE',
//   '016': 'DUPLICATE_FILE_NAME',
//   '017': 'CSV_HEADER_MISMATCH',
//   '018': 'FILE_DOWNLOAD_FAILED',
//   '019': 'FILE_MOVE_FAILED',
//   '020': 'SFTP_CONNECTION_FAILED',
//   // Master
//   '021': 'ACTIVE',
//   '022': 'INACTIVE',
//   '023': 'VALIDATION_FAILED',
//   '024': 'DUPLICATE_BP',
//   '025': 'CROSS_COMPANY_DUPLICATE',
//   '026': 'DUPLICATE_ID_IN_BATCH',
//   '027': 'MISSING_REQUIRED_FIELD',
//   '028': 'FIELD_LENGTH_EXCEEDED',
//   '029': 'INVALID_TYPE',
//   '030': 'INVALID_PORTAL',
//   // Validation
//   '031': 'INVALID_COMPANY',
//   '032': 'INVALID_COUNTRY',
//   '033': 'INVALID_AMOUNT',
//   '034': 'INVALID_CURRENCY',
//   '035': 'INVALID_PAYMENT_TYPE',
//   '036': 'INVALID_PAYMENT_SUBTYPE',
//   '037': 'INVALID_TRANSACTION_STATUS',
//   '038': 'INVALID_DATE',
//   '039': 'REFERENCE_TOO_LONG',
//   '040': 'EXPONENTIAL_REFERENCE',
//   // Transaction
//   '041': 'TRANSACTION_SUCCESS',
//   '042': 'TRANSACTION_FAILED',
//   '043': 'TRANSACTION_PENDING',
//   '044': 'TRANSACTION_RETURN',
//   // Duplicate Checks
//   '045': 'DUPLICATE_MOBI_REFERENCE',
//   '046': 'DUPLICATE_HOST_REFERENCE',
//   '047': 'MOBI_REFERENCE_EXISTS',
//   '048': 'HOST_REFERENCE_EXISTS',
//   // Master Validation
//   '049': 'INVALID_MERCHANT',
//   '050': 'INVALID_HOST',
//   '051': 'INVALID_PORTAL_MASTER',
//   '052': 'INVALID_COMPANY_PORTAL',
//   // Consolidation
//   '053': 'CONSOLIDATION_PENDING',
//   '054': 'CONSOLIDATION_SUCCESS',
//   '055': 'CONSOLIDATION_FAILED',
//   '056': 'GL_ACCOUNT_MISSING',
//   '057': 'MERCHANT_BP_MISSING',
//   '058': 'HOST_BP_MISSING',
//   '059': 'BP_MASTER_MISSING',
//   // Posting
//   '060': 'POSTING_PENDING',
//   '061': 'POSTED',
//   '062': 'POSTING_FAILED',
//    '063': 'BP_CREATED_SUCCESS',
//   '100': 'UNKNOWN_ERROR'
// });

// /* ------------------------------------------------------------------ */
// /* Friendly Error Messages                                            */
// /* ------------------------------------------------------------------ */
// const FRIENDLY = Object.freeze({
//   invalidFileName: (fileName, expected) =>
//     `File name does not match the expected pattern. Received: "${fileName}".` +
//     `Expected format: ${expected}. Please rename the file to the correct pattern and re-upload.`,
//   missingColumn: (missing) =>
//     `CSV header is missing required column(s): ${missing.join(', ')}.` +
//     `Please ensure the CSV contains all mandatory columns before re-uploading.`,
//   missingField: (field) =>
//     `Mandatory field "${field}" is missing or blank. Please populate it and re-upload.`,
//   fieldTooLong: (field, maxLen, actualLen) =>
//     `Field "${field}" exceeds the maximum length of ${maxLen} characters` +
//     `(received ${actualLen} characters). Please shorten the value and re-upload.`,
//   invalidType: (value, allowed) =>
//     `Invalid merchant type "${value}". Allowed values: ${allowed.join(', ')}.` +
//     `Please correct the type and re-upload.`,
//   invalidPortal: (value, allowed) =>
//     `Invalid MOBI_PORTAL_CODE "${value}". Allowed values: ${allowed.join(', ')}.` +
//     `Please use a valid portal code and re-upload.`,
//   invalidCompany: (value, allowed) =>
//     `Invalid SAP_COMPANY_CODE "${value}". Allowed values: ${allowed.join(', ')}.` +
//     `Company code must be numeric; please correct and re-upload.`,
//   invalidCountry: (value) =>
//     `Invalid COUNTRY_CODE "${value}". Must be a valid 2-letter ISO country code` +
//     `(e.g. IN, SG, MY, ID, AE). Please correct and re-upload.`,
//   duplicateIdInBatch: (id) =>
//     `Duplicate ID "${id}" found within the same file. Each merchant/host must be` +
//     `unique per file. Please remove the duplicate and re-upload.`,
//   duplicateBpInDb: (id, company, portal) =>
//     `Duplicate External BP Number "${id}" already exists in the system` +
//     `(Company: ${company}, Portal: ${portal}). Please use a unique ID or update the existing record.`,
//   crossCompanyDuplicate: (id, existingCode, newCode) =>
//     `BP ID "${id}" already exists under Company Code "${existingCode}".` +
//     `It cannot be created again under Company Code "${newCode}".` +
//     `Please verify the company code and re-upload.`,
//   duplicateMobiRef: (ref) =>
//     `Duplicate MOBI_REFERENCE_ID "${ref}" in file. Each transaction reference must be unique.`,
//   duplicateHostRef: (ref, date) =>
//     `Duplicate HOST_REFERENCE_ID "${ref}" on transaction date ${date}.` +
//     `Host reference must be unique per day.`,
//   duplicateMobiRefDb: (ref) =>
//     `MOBI_REFERENCE_ID "${ref}" already exists in the database.` +
//     `Please use a unique reference ID.`,
//   duplicateHostRefDb: (ref) =>
//     `HOST_REFERENCE_ID "${ref}" already exists for the same transaction day in the database.`,
//   invalidAmount: (value) =>
//     `Invalid transaction amount "${value}". Amount must be a positive number greater than zero.`,
//   invalidCurrency: (value) =>
//     `Invalid currency "${value}". Currency must be a 3-letter ISO code (e.g. MYR, IDR, INR).`,
//   invalidPaymentType: (value, allowed) =>
//     `Unsupported payment type "${value}". Allowed values: ${allowed.join(', ')}.`,
//   invalidPaymentSubType: (value, allowed) =>
//     `Unsupported payment sub-type "${value}". Allowed values: ${allowed.join(', ')}.`,
//   invalidTxnStatus: (value, allowed) =>
//     `Unsupported transaction status "${value}". Allowed values: ${allowed.join(', ')}.`,
//   invalidDate: (value) =>
//     `Invalid date value "${value}". Accepted formats: DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY,` +
//     `YYYY-MM-DD, DD-MM-YY. Please correct the date and re-upload.`,
//   refTooLong: (field, maxLen) =>
//     `${field} exceeds ${maxLen} characters. Please shorten the reference ID.`,
//   exponentialRef: (field, value) =>
//     `${field} "${value}" must not be an exponential/scientific number.` +
//     `Please provide the full reference ID as text.`,
//   invalidMerchant: (id) =>
//     `Merchant ID "${id}" is not active for the given portal/company combination.` +
//     `Please check master data or correct the ID.`,
//   invalidHost: (host) =>
//     `Host name "${host}" is not active for the given portal/company combination.` +
//     `Please check master data or correct the host name.`,
//   invalidPortalMaster: (portal) =>
//     `Portal code "${portal}" is not active in master data. Please configure the portal first.`,
//   invalidCompanyPortal: (company, portal) =>
//     `Company code "${company}" is not valid for portal "${portal}".` +
//     `Please verify the company/portal combination.`,
//   fileMoveFailed: (from, to, reason) =>
//     `Failed to move file from "${from}" to "${to}". Reason: ${reason}.` +
//     `Please check SFTP permissions/folder availability.`,
//   fileDownloadFailed: (path, reason) =>
//     `Failed to download file "${path}". Reason: ${reason}.`,
//   sftpConnection: (reason) =>
//     `SFTP connection failed: ${reason}. Please verify destination configuration.`,
//   caseInsensitiveDuplicate: (value, existing) =>
//     `Master ID "${value}" conflicts (case-insensitive) with existing ID "${existing}"` +
//     `for the same portal and company. Master IDs are case-insensitive; please use a unique value.`
// });

// /* ------------------------------------------------------------------ */
// /* Public Helpers                                                     */
// /* ------------------------------------------------------------------ */

// /**
//  * Convert status code to description.
//  *
//  * Example:
//  * toText('014')
//  * returns INVALID_FILE_NAME
//  */
// function toText(code) {
//   if (!code) return '';
//   const statusCode = String(code).padStart(3, '0');
//   return STATUS[statusCode] || statusCode;
// }

// /**
//  * Convert description to status code.
//  * Supports both standard toCode(text, defaultCode) and legacy 3-argument
//  * calls toCode(category, text, defaultCode) for backwards compatibility.
//  *
//  * Example:
//  * toCode('FAILED')
//  * returns 004
//  */
// function toCode(arg1, arg2 = null, arg3 = null) {
//   // If 3 arguments passed (e.g. toCode('FILE', statusText, '005')),
//   // arg2 is text and arg3 is defaultCode.
//   const text = arg3 !== null ? arg2 : arg1;
//   const defaultCode = arg3 !== null ? arg3 : arg2;

//   if (!text) return defaultCode;
//   const value = String(text)
//     .trim()
//     .toUpperCase();

//   // Aliases for common legacy or extended status text strings
//   const ALIASES = {
//     'RECEIVED': '011',
//     'FILE_RECEIVED': '011',
//     'PARTIALLY_PROCESSED': '005',
//     'PARTIALLY_COMPLETED': '005',
//     'BP CREATION SUCCESS': '006',
//     'BP FAILED': '004',
//     'NOT_INSERTED': '010',
//     'VALIDATION_FAILED': '023',
//     '01': '001',
//     '02': '002',
//     '03': '003',
//     '04': '005',
//     '05': '004'
//   };

//   if (ALIASES[value]) {
//     return ALIASES[value];
//   }

//   for (const [code, description] of Object.entries(STATUS)) {
//     if (description === value) {
//       return code;
//     }
//   }
//   // If already a valid status code
//   if (STATUS[value]) {
//     return value;
//   }
//   return defaultCode;
// }

// /**
//  * Returns both code and description.
//  *
//  * Example:
//  * describe('014')
//  *
//  * {
//  *   code: '014',
//  *   text: 'INVALID_FILE_NAME'
//  * }
//  */
// function describe(code) {
//   const statusCode = String(code || '')
//     .padStart(3, '0');
//   return {
//     code: statusCode,
//     text: toText(statusCode)
//   };
// }

// /* ------------------------------------------------------------------ */
// /* Populate MOBI_DB_STATUS                                             */
// /* ------------------------------------------------------------------ */

// /**
//  * Loads status values into MOBI_DB_STATUS.
//  */
// async function ensureStatusTable() {
//   try {
//     const db = await cds.connect.to('db');
//     const entries = Object.entries(STATUS)
//       .map(([STATUS_CODE, DESCRIPTION]) => ({
//         STATUS_CODE,
//         DESCRIPTION
//       }));
//     const chunkSize = 100;
//     for (let i = 0; i < entries.length; i += chunkSize) {
//       const chunk = entries.slice(i, i + chunkSize);
//       try {
//         await db.run(
//           INSERT
//             .into('mobi.db.MOBI_DB_STATUS')
//             .entries(chunk)
//         );
//       } catch (err) {
//         // Ignore duplicates
//         // Existing status records remain unchanged
//         for (const row of chunk) {
//           try {
//             await db.run(
//               INSERT
//                 .into('mobi.db.MOBI_DB_STATUS')
//                 .entries(row)
//             );
//           } catch (_) {
//             // already exists
//           }
//         }
//       }
//     }
//   } catch (err) {
//     console.warn(
//       '[StatusCodeUtil] ensureStatusTable skipped:',
//       err.message
//     );
//   }
// }

// /* ------------------------------------------------------------------ */
// /* Error Utilities                                                     */
// /* ------------------------------------------------------------------ */

// /**
//  * Combine multiple errors into readable text.
//  */
// function joinErrorDetails(errors) {
//   if (!errors || !errors.length) {
//     return '';
//   }
//   return errors
//     .map((error, index) =>
//       `[${index + 1}] (${error.code || '100'}) ${error.message}`
//     )
//     .join(' || ');
// }

// /**
//  * Extract unique error codes.
//  */
// function joinErrorCodes(errors) {
//   if (!errors || !errors.length) {
//     return '';
//   }
//   return [
//     ...new Set(
//       errors
//         .map(error =>
//           String(error.code || '100')
//             .padStart(2, '0')
//         )
//     )
//   ].join(',');
// }

// /* ------------------------------------------------------------------ */
// /* Export                                                              */
// /* ------------------------------------------------------------------ */
// module.exports = Object.freeze({
//   STATUS,
//   FRIENDLY,
//   toText,
//   toCode,
//   describe,
//   ensureStatusTable,
//   joinErrorDetails,
//   joinErrorCodes
// });
