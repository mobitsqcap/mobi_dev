const Constants = require('../utils/Constants');
const CsvUtil = require('../utils/CsvUtil');
const MasterRecord = require('../models/MasterRecord');
const MasterValidator = require('./MasterValidator');
const ValidationError = require('../models/ValidationError');
const StatusCodeUtil = require('../utils/StatusCodeUtil');
const F = StatusCodeUtil.FRIENDLY;

class MasterCsvService {
  constructor() {
    this.validator = new MasterValidator();
  }

  parse(buffer, existingIdKeys = new Set()) {
    const { headers, rows } = CsvUtil.parseNormalized(buffer);
    try {
      this._validateHeaders(headers);
    } catch (error) {
      error.totalRows = rows.length;
      error.validCount = 0;
      error.errorCount = rows.length;
      throw error;
    }

    // REQUIREMENT: If the file has only headers without any data rows (empty file),
    // reject it immediately with EMPTY_FILE (013) so it moves to ERROR folder
    // and logs exact error details in MOBI_DB_FILELOG and MOBI_DB_AUDIT.
    if (!rows || rows.length === 0) {
      const error = new ValidationError(
        StatusCodeUtil.toCode('EMPTY_FILE', '013'),
        'The uploaded CSV file contains only headers without any data records. Please include at least one valid record and re-upload.'
      );
      error.code = '013'; // EMPTY_FILE
      error.totalRows = 0;
      error.validCount = 0;
      error.errorCount = 0;
      throw error;
    }

    const records = rows.map((r, index) => MasterRecord.fromCsvRow(r, index + 2));
    const { validRecords, errorRows } = this.validator.validateRecords(records, { existingIdKeys });
    return {
      totalRows: rows.length,
      records: validRecords,
      errorRows,
      validCount: validRecords.length,
      errorCount: errorRows.length
    };
  }

  _validateHeaders(actualHeaders) {
    const missing = [];
    for (const logicalHeader of Constants.MASTER_REQUIRED_HEADERS) {
      const aliases = Constants.MASTER_HEADERS[logicalHeader] || [logicalHeader];
      if (!aliases.some((alias) => actualHeaders.includes(alias))) {
        missing.push(`${logicalHeader} (${aliases.join(' / ')})`);
      }
    }
    if (missing.length) {
      const error = new ValidationError('25', F.missingColumn(missing));
      error.code = '25';
      throw error;
    }
  }
}

module.exports = MasterCsvService;
