const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;
const { v4: uuid } = require('uuid');
const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');
const HashUtil = require('../utils/HashUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

class FileLogRepository {
  async createInitial(file, auditId, fileHash, sizeBytes, createdBy = Constants.SYSTEM_USERS.SFTP) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const record = {
      AUDIT_ID: auditId,
      FILE_ID: HashUtil.sha256(`${file.name}|${now}`),
      FILE_NAME: file.name,
      FILE_PATH: file.path,
      FILE_SIZE_BYTES: sizeBytes ?? null,
      FILE_HASH: fileHash || '',
      ROW_COUNT_TOTAL: 0,
      ROW_COUNT_VALID: 0,
      ROW_COUNT_ERROR: 0,
      STATUS: 'RECEIVED',
      STATUS_CODE: StatusCodeUtil.toCode('RECEIVED', '011'),
      ERROR_DETAIL: '',
      RECEIVED_AT: now,
      PROCESS_START_AT: now,
      PROCESS_END_AT: now,
      CREATED_BY: createdBy,
      CREATED_TIMESTAMP: now,
      CHANGED_BY: ' '
    };
    await db.run(INSERT.into('mobi.db.MOBI_DB_FILELOG').entries(record));
    return record;
  }

  async ensureTracked(file, createdBy = Constants.SYSTEM_USERS.SFTP) {
    const existing = await this.findLatestRetryableByFile(file);
    if (existing) return existing;
    return this.createInitial(file, uuid(), null, file.sizeBytes ?? null, createdBy);
  }

  async findLatestRetryableByFile(file) {
    const db = await cds.connect.to('db');
    const rows = await db.run(
      SELECT.from('mobi.db.MOBI_DB_FILELOG').where({
        FILE_NAME: file.name,
        STATUS_CODE: { in: ['01', '02', '05', '04', '001', '002', '004', '005', '011'] }
      })
    );
    return (rows || [])
      .filter((row) => {
        const p = String(row.FILE_PATH || '').toLowerCase();
        return p === file.path || (!p.includes('/fileout/') && !p.includes('/file_out/'));
      })
      .sort((a, b) => new Date(b.CREATED_TIMESTAMP || 0).getTime() - new Date(a.CREATED_TIMESTAMP || 0).getTime())[0] || null;
  }

  async findByHash(hash) {
    const db = await cds.connect.to('db');
    return db.run(SELECT.one.from('mobi.db.MOBI_DB_FILELOG').where({ FILE_HASH: hash }));
  }

  async updateFileDetails(auditId, { filePath, fileHash, sizeBytes }, changedBy) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    await db.run(
      UPDATE('mobi.db.MOBI_DB_FILELOG')
        .set({
          FILE_PATH: filePath,
          FILE_HASH: fileHash,
          FILE_SIZE_BYTES: sizeBytes,
          CHANGED_BY: ' '
        })
        .where({ AUDIT_ID: auditId })
    );
  }

  async markPicked(auditId, { filePath, fileHash, sizeBytes, totalRows = 0, validCount = 0, errorCount = 0 }, changedBy) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    await db.run(
      UPDATE('mobi.db.MOBI_DB_FILELOG')
        .set({
          FILE_PATH: filePath,
          FILE_HASH: fileHash,
          FILE_SIZE_BYTES: sizeBytes,
          ROW_COUNT_TOTAL: totalRows,
          ROW_COUNT_VALID: validCount,
          ROW_COUNT_ERROR: errorCount,
          STATUS: 'PROCESSING',
          STATUS_CODE: StatusCodeUtil.toCode('PROCESSING', '002'),
          PROCESS_START_AT: now,
          CHANGED_BY: ' '
        })
        .where({ AUDIT_ID: auditId })
    );
  }

  async updateProcessingStats(auditId, stats, changedBy) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    await db.run(
      UPDATE('mobi.db.MOBI_DB_FILELOG')
        .set({
          ROW_COUNT_TOTAL: stats.totalRows,
          ROW_COUNT_VALID: stats.validCount,
          ROW_COUNT_ERROR: stats.errorCount,
          CHANGED_BY: ' '
        })
        .where({ AUDIT_ID: auditId })
    );
  }

  async updateResult(auditId, result, fileHash, changedBy = Constants.SYSTEM_USERS.SFTP, completedPath, options = {}) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const statusText = options.statusOverride ||
      (result.validCount > 0 && result.errorCount > 0 ? 'PARTIALLY_COMPLETED'
        : result.validCount > 0 ? 'COMPLETED' : 'FAILED');
    const statusCode = StatusCodeUtil.toCode(statusText, '003');
    const payload = {
      FILE_HASH: fileHash || '',
      ROW_COUNT_TOTAL: result.totalRows ?? 0,
      ROW_COUNT_VALID: result.validCount ?? 0,
      ROW_COUNT_ERROR: result.errorCount ?? 0,
      STATUS: statusText,
      STATUS_CODE: statusCode,
      ERROR_DETAIL: String(options.errorDetail || '').substring(0, 500),
      PROCESS_END_AT: now,
      CHANGED_BY: ' '
    };
    if (completedPath) payload.FILE_PATH = completedPath;
    await db.run(UPDATE('mobi.db.MOBI_DB_FILELOG').set(payload).where({ AUDIT_ID: auditId }));
  }

  async markFailed(auditId, errorDetail, changedBy = Constants.SYSTEM_USERS.SFTP, details = {}) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();

    let errCode = details.errorCode ? String(details.errorCode).trim() : '';
    if (!errCode && details.error && details.error.code) errCode = String(details.error.code).trim();
    const statusCode = (errCode && StatusCodeUtil.STATUS[errCode])
      ? errCode
      : StatusCodeUtil.toCode('FAILED', '004');

    const statusName = (statusCode === '015')
      ? 'DUPLICATE_FILE'
      : (statusCode === '013')
        ? 'EMPTY_FILE'
        : (statusCode === '014')
          ? 'INVALID_FILE_NAME'
          : 'FAILED';

    const payload = {
      STATUS: statusName,
      STATUS_CODE: statusCode,
      ERROR_DETAIL: String(errorDetail || '').substring(0, 500),
      PROCESS_END_AT: now,
      CHANGED_BY: ' '
    };
    for (const k of ['FILE_PATH', 'FILE_HASH', 'FILE_SIZE_BYTES', 'ROW_COUNT_TOTAL', 'ROW_COUNT_VALID', 'ROW_COUNT_ERROR']) {
      if (details[k] !== undefined) payload[k] = details[k];
    }
    await db.run(UPDATE('mobi.db.MOBI_DB_FILELOG').set(payload).where({ AUDIT_ID: auditId }));
  }
}

module.exports = FileLogRepository;
