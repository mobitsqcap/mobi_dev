'use strict';

const path = require('path');

const Constants = require('../constants/ConsolidationConstants');
const DateUtil = require('../utils/DateUtil');
const NormalizeUtil = require('../utils/NormalizeUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

/**
 * Maps a scenario code to the suffix used in the error file name.
 * Each scenario gets its own file so Payin / Payout / Domestic Settlement
 * never overwrite each other.
 */
function errorFileSuffix(scenarioCode) {
  if (scenarioCode === 'PAYIN') return 'Payins';
  if (scenarioCode === 'PAYOUT') return 'Payout';
  if (scenarioCode === 'DOMESTIC_SETTLEMENT') return 'DomesticSettlement';
  return scenarioCode || 'Consolidation';
}

class ConsolidationErrorReporter {
  constructor(sftpService) {
    this.sftpService = sftpService;
  }

  async writeErrorReport({ postingDate, scenarioCode, errorRecords, changedBy, runId }) {
    const records = (errorRecords || []).filter(Boolean);
    if (!records.length) return null;

    const date8 = DateUtil.date8(postingDate);
    const suffix = errorFileSuffix(scenarioCode);
    const fileName = `Transactions_${date8}_${suffix}.file`;
    const remotePath = path.posix.join(Constants.SFTP.CONSOL_ERROR_PATH, fileName);

    const buffer = this._buildTextFile({
      fileName, auditId: runId || scenarioCode || 'CONSOLIDATION',
      scenarioCode, postingDate: date8, records
    });

    await this.sftpService.uploadFile(remotePath, buffer);

    return {
      remotePath,
      fileName,
      date8,
      scenarioCode,
      recordsWritten: records.length
    };
  }

  /**
   * When a scenario's run comes back clean (all GL/BP fixed), write a timestamped
   * "RESOLVED" file and delete the old error file. Uses uploadFile + deleteFile
   * (no rename dependency).
   *
   *   old: Transactions_YYYYMMDD_Payins.file
   *   new: Transactions_YYYYMMDD_Payins_HHMMSS.file  (RESOLVED content)
   */
  async resolveErrorReport({ postingDate, scenarioCode, consolidatedCount = 0 }) {
    const date8 = DateUtil.date8(postingDate);
    const suffix = errorFileSuffix(scenarioCode);
    const oldPath = path.posix.join(Constants.SFTP.CONSOL_ERROR_PATH, `Transactions_${date8}_${suffix}.file`);

    let exists = false;
    try { exists = await this.sftpService.exists(oldPath); } catch (_) { exists = false; }
    if (!exists) return null;

    const hhmmss = DateUtil.nowHHMMSS();
    const newFileName = `Transactions_${date8}_${suffix}_${hhmmss}.file`;
    const newPath = path.posix.join(Constants.SFTP.CONSOL_ERROR_PATH, newFileName);

    const generatedAt = new Date().toISOString();
    const body = [
      'STATUS           : RESOLVED',
      `FILE NAME        : ${newFileName}`,
      `SCENARIO         : ${scenarioCode || 'CONSOLIDATION'}`,
      `GENERATED AT     : ${generatedAt}`,
      '',
      `All GL account / business-partner issues for posting date ${date8} (${scenarioCode}) have been fixed.`,
      `${consolidatedCount} record(s) consolidated successfully in the last run.`,
      'This file previously listed the blocked records; they have now been processed.'
    ].join('\n');

    // Write the resolved content to a timestamped file, then remove the old one.
    await this.sftpService.uploadFile(newPath, Buffer.from(body, 'utf8'));
    try { await this.sftpService.deleteFile(oldPath); } catch (_) { /* best-effort cleanup */ }

    return { fileName: newFileName, rewritten: true };
  }

  _buildTextFile({ fileName, auditId, scenarioCode, postingDate, records }) {
    const sanitize = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();
    const generatedAt = new Date().toISOString();

    const codeTexts = [...new Set(
      records
        .map((entry) => StatusCodeUtil.toText(entry.statusCode))
        .filter(Boolean)
    )];

    const lines = [
      `FILE NAME       : ${fileName}`,
      `AUDIT ID        : ${auditId}`,
      `SCENARIO        : ${scenarioCode || 'CONSOLIDATION'}`,
      `ERROR CODE      : ${codeTexts.join(',') || 'CONSOLIDATION_FAILED'}`,
      `ERROR DETAIL    : ${records.length} record(s) blocked during ${scenarioCode || 'CONSOLIDATION'} consolidation (posting date ${postingDate}) due to missing GL account / business-partner configuration.`,
      `GENERATED AT    : ${generatedAt}`,
      '',
      'This file contains the consolidation records that failed validation.',
      '',
      'Only invalid records are listed below in a human-readable format.',
      '',
      'S.NO | AUDIT_ID | ROW_NO | MOBI_REFERENCE_ID | PAYMENT_TYPE | COMPANY_CODE | MOBI_PORTAL_CODE | ERROR_CODE | ERROR_DETAIL'
    ];

    records.forEach((entry, index) => {
      const record = entry.record || {};
      lines.push([
        index + 1,
        auditId,
        '',
        NormalizeUtil.text(record.MOBI_REFERENCE_ID),
        NormalizeUtil.text(record.PAYMENT_TYPE),
        NormalizeUtil.text(record.COMPANY_CODE),
        NormalizeUtil.text(record.MOBI_PORTAL_CODE),
        StatusCodeUtil.toText(entry.statusCode),
        sanitize(entry.message)
      ].join(' | '));
    });

    return Buffer.from(lines.join('\n'), 'utf8');
  }
}

module.exports = ConsolidationErrorReporter;
