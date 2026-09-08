/**
 * AuditMessType
 * -------------
 * Message-type vocabulary + message builders for the NEW MOBI_DB_AUDIT table.
 *
 * MESSAGE_TYPE stores the SINGLE-LETTER code (the DB column is String(1)):
 *
 *   Code | Display  | Meaning
 *   -----|----------|--------------------------------------------------
 *   W    | Warning  | File completed with errors (file-level row)
 *   I    | Info     | File received / processing in progress
 *   E    | Error    | Record error, CPI error, or file failure
 *   S    | Success  | Fully successful file, record inserted, BP created, CPI success
 *
 * Every builder appends the FILE NAME to the message:
 *   - "Row 3| Data Inserted | File: Master_20260806.csv"
 *   - "File Master_20260806.csv completed successfully. total=10, inserted=8, errors=2."
 */

const MESS = Object.freeze({
  INFO:    'I',
  SUCCESS: 'S',
  WARNING: 'W',
  ERROR:   'E'
});

/** Display label per stored code (documentation / UI use). */
const MESS_LABEL = Object.freeze({
  W: 'Warning',
  I: 'Info',
  E: 'Error',
  S: 'Success'
});

/** Hard fallback so MESSAGE_TYPE can never be written as null. */
function safe(type) {
  return MESS[type] || 'I';
}

function _fileSuffix(fileName) {
  const name = String(fileName || '').trim();
  return name ? ` | File: ${name}` : '';
}

function _fileHead(fileName) {
  const name = String(fileName || '').trim();
  return name ? `File ${name} completed successfully` : 'File completed successfully';
}

/**
 * File-level summary message (with file name).
 * Excel: "File completed successfully. total=10, inserted=8, errors=2."
 * Now:   "File Master_20260806.csv completed successfully. total=10, inserted=8, errors=2."
 */
function fileSummaryMessage(total, inserted, errors, fileName) {
  return `${_fileHead(fileName)}. total=${Number(total) || 0}, inserted=${Number(inserted) || 0}, errors=${Number(errors) || 0}.`;
}

/** Interim PROCESSING message for the FILE summary row (AUDIT_LINE_ITEM = 1). */
function processingMessage(validCount, errorCount, totalRows, fileName) {
  const base = `PROCESSING: ${Number(validCount) || 0} valid, ${Number(errorCount) || 0} error(s) of ${Number(totalRows) || 0} total records`;
  return base + _fileSuffix(fileName);
}

/** File received message. */
function receivedMessage(fileName) {
  const name = String(fileName || '').trim();
  return name ? `File ${name} received. Processing started.` : 'File received. Processing started.';
}

/**
 * Record inserted.
 * e.g. "Row 2| Data Inserted | M123 Acme Traders | File: Master_20260806.csv"
 * (id = merchant/master ID, masterName = MASTER_NAME)
 */
function recordInsertedMessage(rowNo, id, masterName, fileName) {
  let base = rowNo ? `Row ${rowNo}| Data Inserted` : 'Data Inserted';
  const idStr = String(id || '').trim();
  const nameStr = String(masterName || '').trim();
  const info = [idStr, nameStr].filter(Boolean).join(' ');
  if (info) base += `| ${info}`;
  return base + _fileSuffix(fileName);
}

/** Record error. Excel: "Row 2| Error Detail" -> now with file name. */
function recordErrorMessage(rowNo, detail, fileName) {
  const body = String(detail || '').trim() || 'Error Detail';
  const base = rowNo ? `Row ${rowNo}| ${body}` : body;
  return base + _fileSuffix(fileName);
}

/**
 * CPI success.
 * e.g. "Row 1| 60000571 created successfully for 2201"
 * (bpNumber = SAP BP number created, externalBpNumber = external BP number / merchant id)
 */
function cpiSuccessMessage(rowNo, bpNumber, externalBpNumber, fileName) {
  const bp = String(bpNumber || '').trim();
  const ext = String(externalBpNumber || '').trim();
  let base;
  if (bp && ext) base = `${bp} created successfully for ${ext}`;
  else if (bp) base = `${bp} created successfully`;
  else if (ext) base = `BP created successfully for ${ext}`;
  else base = 'BP Number Created successfully for External Bp number';
  const msg = rowNo ? `Row ${rowNo}| ${base}` : base;
  return msg + _fileSuffix(fileName);
}

/**
 * CPI error.
 * e.g. "Row 26| BP Creation Failed| Error Detail passed by CPI"
 *      "Row 26| BP Creation Failed| Some SAP error passed by CPI"
 * (detail = the error detail sent by CPI; falls back to "Error Detail passed by CPI")
 */
function cpiErrorMessage(rowNo, detail, fileName) {
  const body = 'BP Creation Failed';
  const detailStr = String(detail || '').trim() || 'Error Detail passed by CPI';
  const base = rowNo ? `Row ${rowNo}| ${body}| ${detailStr}` : `${body}| ${detailStr}`;
  return base + _fileSuffix(fileName);
}

/** CPI batch summary appended to the FILE summary row. */
function cpiSummaryMessage(success, fail, total, fileName) {
  const base = `COMPLETED: ${Number(success) || 0} BPs created successfully, ${Number(fail) || 0} failed of ${Number(total) || 0} total records`;
  return base + _fileSuffix(fileName);
}

/** File failure message (FILE summary row). */
function failedMessage(fileName, detail) {
  const body = String(detail || '').trim() || 'File processing failed';
  const name = String(fileName || '').trim();
  return name ? `File ${name}: ${body}` : body;
}

module.exports = {
  MESS,
  MESS_LABEL,
  safe,
  fileSummaryMessage,
  processingMessage,
  receivedMessage,
  recordInsertedMessage,
  recordErrorMessage,
  cpiSuccessMessage,
  cpiErrorMessage,
  cpiSummaryMessage,
  failedMessage
};
