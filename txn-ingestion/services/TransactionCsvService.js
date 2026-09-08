'use strict';

const Constants = require('../utils/Constants');
const CsvUtil = require('../utils/CsvUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');
const TransactionRecord = require('../models/TransactionRecord');

class TransactionCsvService {
  parse(buffer, auditId) {
    let normalized;
    try {
      normalized = CsvUtil.parseNormalized(buffer);
    } catch (error) {
      error.code = StatusCodeUtil.toCode('CSV_HEADER_MISMATCH');
      error.totalRows = 0;
      error.errorCount = 0;
      throw error;
    }

    const { headers, rows } = normalized;

    if (!headers.length || !rows.length) {
      const error = new Error('Transaction CSV is empty or contains no data rows');
      error.code = StatusCodeUtil.toCode('EMPTY_FILE');
      error.totalRows = rows.length;
      error.errorCount = rows.length;
      error.rawRows = rows;
      throw error;
    }

    try {
      this._validateHeaders(headers);
    } catch (error) {
      error.totalRows = rows.length;
      error.validCount = 0;
      error.errorCount = rows.length;
      error.rawRows = rows;
      throw error;
    }

    return {
      auditId,
      totalRows: rows.length,
      records: rows.map((row) => TransactionRecord.fromCsvRow(row, auditId))
    };
  }

  _validateHeaders(actualHeaders) {
    const expected = Constants.TRANSACTION_CSV_COLUMNS;
    const missing = expected.filter((header) => !actualHeaders.includes(header));
    const duplicate = actualHeaders.filter((header, index) => actualHeaders.indexOf(header) !== index);

    if (missing.length || duplicate.length) {
      const pieces = [];
      if (missing.length) pieces.push(StatusCodeUtil.FRIENDLY.missingColumn(missing));
      if (duplicate.length) pieces.push(`Duplicate CSV column(s): ${[...new Set(duplicate)].join(', ')}.`);
      const error = new Error(pieces.join(' '));
      error.code = StatusCodeUtil.toCode('CSV_HEADER_MISMATCH');
      throw error;
    }
  }
}

module.exports = TransactionCsvService;
