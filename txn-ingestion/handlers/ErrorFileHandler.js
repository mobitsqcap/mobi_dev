'use strict';

const path = require('path');

const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');
const CsvUtil = require('../utils/CsvUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

class ErrorFileHandler {
  constructor(sftpService) {
    this.sftpService = sftpService;
  }

  _resolveErrorDirectory(file, context = {}) {
    if (context.errorPath) return path.posix.dirname(context.errorPath);
    return context.paths?.ERROR_PATH || file?.paths?.ERROR_PATH || null;
  }

  async handle(file, rowsForErrorCsv, context = {}) {
    const errorDirectory = this._resolveErrorDirectory(file, context);
    if (!errorDirectory) throw new Error(`ERROR path missing for file ${file.name}`);

    const allRows = rowsForErrorCsv || [];

    const invalidRows = allRows.filter((row) =>
      row.ROW_STATUS === Constants.ROW_STATUS.INVALID || row._FILE_LEVEL_ERROR
    );

    const date8 = context.date8 || DateUtil.extractDate8(file.name) || 'UNKNOWN';
    const auditId = context.auditId || context.fileLog?.AUDIT_ID || '';
    const errorCode = StatusCodeUtil.normalizeCode(context.errorCode, 'VALIDATION_FAILED');
    const names = this._outputNames(file.name, date8, context);

    const errorCsvPath = context.skipErrorCsv
      ? null
      : path.posix.join(errorDirectory, names.csv);

    const errorTextPath = path.posix.join(errorDirectory, names.text);

    if (errorCsvPath) {
      const csvBuffer = context.sourceBuffer
        ? Buffer.from(context.sourceBuffer)
        : this._buildOriginalCsv(allRows);
      await this.sftpService.uploadFile(errorCsvPath, csvBuffer);
    }

    await this.sftpService.uploadFile(
      errorTextPath,
      this._buildErrorTextFile(file.name, invalidRows, auditId, {
        validCount: Number(context.validCount || 0),
        errorCode,
        customDetail: context.errorDetail,
        fileLevelFailure: Boolean(context.fileLevelFailure)
      })
    );

    console.error(
      `[ErrorFileHandler] ${file.name}: ${invalidRows.length} invalid row(s),` +
      `${allRows.length} source row(s) reported in ${errorDirectory}`
    );

    return { errorCsvPath, errorTextPath };
  }

  _outputNames(fileName, date8, context) {
    if (!context.sourceBaseNaming) {
      return {
        csv: Constants.ERROR_NAMING.FAILED_CSV(date8),
        text: Constants.ERROR_NAMING.ERROR_TEXT(date8)
      };
    }

    let base = path.posix.basename(String(fileName || ''), path.posix.extname(fileName));
    base = base.replace(/_ERRORS$/i, '');

    return {
      csv: `${base}_ERRORS.csv`,
      text: `${base}_text.file`
    };
  }

  _toSourceCsvRow(record) {
    const raw = record?._RAW_ROW || {};

    const mapped = {
      mobi_portal_code: record?.MOBI_PORTAL_CODE,
      sap_company_code: record?.COMPANY_CODE,
      payment_type: record?.PAYMENT_TYPE,
      payment_sub_type: record?.PAYMENT_SUB_TYPE,
      mobi_reference_id: record?.MOBI_REFERENCE_ID,
      merchant_id: record?.MERCHANT_ID,
      merchant_type: record?.MERCHANT_TYPE,
      merchant_name: record?.MERCHANT_NAME,
      txn_created_date: record?.TXN_CREATED_DATE,
      txn_paid_date: record?.TXN_PAID_DATE,
      txn_time_created: record?.TXN_CREATED_TIME,
      txn_time_paid: record?.TXN_PAID_TIME,
      payment_method: record?.PAYMENT_METHOD,
      host_name: record?.HOST_NAME,
      transaction_amount: record?.TXN_AMOUNT,
      host_mdr_amount: record?.HOST_MDR_AMOUNT,
      host_fee_payable: record?.HOST_FEE_PAYABLE,
      mobi_mdr_amount: record?.MOBI_MDR_AMOUNT,
      mdr_revenue: record?.MDR_REVENUE,
      ar_payin: record?.AR_PAYIN,
      ap_payin: record?.AP_PAYIN,
      ap_payout: record?.AP_PAYOUT,
      host_reference_id: record?.HOST_REFERENCE_ID,
      merchant_reference_id: record?.MERCHANT_REFERENCE_ID,
      transaction_status: record?.TXN_STATUS,
      original_amount: record?.ORIGINAL_AMOUNT,
      transaction_currency: record?.TXN_CURRENCY,
      settled_in_currency: record?.SETTLED_IN_CURRENCY,
      time_zone: record?.TIME_ZONE,
      conversion_rate: record?.CONVERSION_RATE,
      balance_check: record?.BALANCE_CHECK
    };

    return Object.fromEntries(
      Constants.TRANSACTION_CSV_COLUMNS.map((header) => [
        header,
        raw[header] ?? mapped[header] ?? ''
      ])
    );
  }

  _buildOriginalCsv(rows) {
    return Buffer.from(
      CsvUtil.serialize(
        Constants.TRANSACTION_CSV_COLUMNS,
        (rows || []).map((row) => this._toSourceCsvRow(row))
      ),
      'utf8'
    );
  }

  _buildErrorTextFile(fileName, invalidRows, auditId, options = {}) {
    const sanitize = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();
    const generatedAt = DateUtil.nowTimestamp().toISOString();

    let rows;
    if (options.fileLevelFailure) {
      rows = [{
        _ROW_NUMBER: '',
        STATUS_CODE: options.errorCode,
        STATUS_MESSAGE: options.customDetail || StatusCodeUtil.toText(options.errorCode)
      }];
    } else {
      rows = [...(invalidRows || [])];
    }

    const lines = [
      `FILE NAME       : ${fileName}`,
      `AUDIT ID        : ${auditId}`
    ];

    if (options.fileLevelFailure) {
      lines.push(
        `ERROR CODE      : ${this._displayCode(options.errorCode)}`,
        `ERROR DETAIL    : ${sanitize(options.customDetail)}`
      );
    }

    lines.push(`GENERATED AT    : ${generatedAt}`);

    if (options.fileLevelFailure) {
      lines.push(
        'This file contains the failed record details in a human-readable format.',
        '',
        'If a field is not available at the time of failure, it is left blank.'
      );
    } else {
      lines.push(
        'This file contains the transaction records that failed validation.',
        '',
        'Only invalid records are listed below in a human-readable format.'
      );
    }

    lines.push(
      '',
      'S.NO | AUDIT_ID | ROW_NO | MOBI_REFERENCE_ID | PAYMENT_TYPE | COMPANY_CODE | MOBI_PORTAL_CODE | ERROR_CODE | ERROR_DETAIL'
    );

    rows.forEach((row, index) => {
      lines.push([
        index + 1,
        auditId,
        row._ROW_NUMBER || '',
        row.MOBI_REFERENCE_ID || row._RAW_ROW?.mobi_reference_id || '',
        row.PAYMENT_TYPE || row._RAW_ROW?.payment_type || '',
        row.COMPANY_CODE || row._RAW_ROW?.sap_company_code || '',
        row.MOBI_PORTAL_CODE || row._RAW_ROW?.mobi_portal_code || '',
        this._rowDisplayCode(row, options.errorCode),
        sanitize(this._rowDisplayMessage(row, options.customDetail))
      ].join(' | '));
    });

    return Buffer.from(lines.join('\n'), 'utf8');
  }

  _rowDisplayCode(row, fallbackCode) {
    const errors = row?._VALIDATION_ERRORS || [];
    if (errors.length) {
      return [...new Set(errors.map((error) => StatusCodeUtil.toText(error.code)))].join(',');
    }
    return this._displayCode(row?.STATUS_CODE || fallbackCode);
  }

  _rowDisplayMessage(row, fallbackDetail) {
    const detail = StatusCodeUtil.recordErrorDetail(row);
    return detail || this._displayMessage(fallbackDetail);
  }

  _displayCode(value) {
    return String(value || '')
      .split(',')
      .filter(Boolean)
      .map((code) => StatusCodeUtil.toText(code.trim()))
      .join(',');
  }

  _displayMessage(value) {
    return String(value || '')
      .replace(/\[\d+\]\s*\(\d{3}\)\s*/g, '')
      .replace(/\s*\|\|\s*/g, ' || ')
      .trim();
  }
}

module.exports = ErrorFileHandler;