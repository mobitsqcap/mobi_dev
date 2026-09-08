'use strict';

const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;

const { v4: uuid } = require('uuid');

const DateUtil = require('../utils/DateUtil');
const HashUtil = require('../utils/HashUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

const ENTITY = 'mobi.db.MOBI_DB_FILELOG';
const USER = 'SYSTEM_SFTP';

class FileLogRepository {
  async createInitial(file, auditId = uuid(), fileHash = '', sizeBytes = 0) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const code = StatusCodeUtil.toCode('FILE_RECEIVED');

    const record = {
      AUDIT_ID: auditId,
      FILE_ID: HashUtil.sha256(`${file.name}|${auditId}`),
      FILE_NAME: file.name,
      FILE_PATH: file.path,
      FILE_SIZE_BYTES: sizeBytes ?? 0,
      FILE_HASH: fileHash,
      ROW_COUNT_TOTAL: 0,
      ROW_COUNT_VALID: 0,
      ROW_COUNT_ERROR: 0,
      STATUS: StatusCodeUtil.toText(code),
      STATUS_CODE: code,
      ERROR_CODE: '',
      ERROR_DETAIL: '',
      RECEIVED_AT: now,
      PROCESS_START_AT: null,
      PROCESS_END_AT: null,
      CREATED_BY: USER,
      CREATED_TIMESTAMP: now,
      CHANGED_BY: '',
      CHANGED_TIMESTAMP: null
    };

    await db.run(INSERT.into(ENTITY).entries(record));
    return record;
  }

  async createNewAttempt(file) {
    return this.createInitial(file, uuid(), '', file.sizeBytes ?? 0);
  }

  async ensureTracked(file) {
    const existing = await this.findLatestRetryableByFile(file);
    return existing || this.createInitial(file);
  }

  async hasAnyFileName(fileName) {
    const db = await cds.connect.to('db');
    const row = await db.run(
      SELECT.one.from(ENTITY).columns('AUDIT_ID').where({ FILE_NAME: fileName })
    );
    return Boolean(row);
  }

  async findLatestRetryableByFile(file) {
    const db = await cds.connect.to('db');
    const retryable = [
      StatusCodeUtil.toCode('FILE_RECEIVED'),
      StatusCodeUtil.toCode('PROCESSING'),
      StatusCodeUtil.toCode('FAILED')
    ];
    const rows = await db.run(
      SELECT.from(ENTITY).where({ FILE_NAME: file.name, STATUS_CODE: { in: retryable } })
    );
    return (rows || [])
      .filter((row) => {
        const stored = String(row.FILE_PATH || '').toLowerCase();
        const current = String(file.path || '').toLowerCase();
        return stored === current || (!stored.includes('/fileout/') && !stored.includes('/file_out/'));
      })
      .sort((a, b) => new Date(b.CREATED_TIMESTAMP || 0) - new Date(a.CREATED_TIMESTAMP || 0))[0] || null;
  }

  async findByHash(hash) {
    if (!hash) return null;
    const db = await cds.connect.to('db');
    return db.run(SELECT.one.from(ENTITY).where({ FILE_HASH: hash }));
  }

  async markPicked(auditId, details = {}) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const code = StatusCodeUtil.toCode('PROCESSING');
    await db.run(
      UPDATE(ENTITY).set({
        FILE_PATH: details.filePath,
        FILE_HASH: details.fileHash || '',
        FILE_SIZE_BYTES: details.sizeBytes ?? 0,
        ROW_COUNT_TOTAL: details.totalRows ?? 0,
        ROW_COUNT_VALID: details.validCount ?? 0,
        ROW_COUNT_ERROR: details.errorCount ?? 0,
        STATUS: StatusCodeUtil.toText(code),
        STATUS_CODE: code,
        ERROR_CODE: '',
        ERROR_DETAIL: '',
        PROCESS_START_AT: now,
        PROCESS_END_AT: null,
        CHANGED_BY: details.changedBy || '',
        CHANGED_TIMESTAMP: null
      }).where({ AUDIT_ID: auditId })
    );
  }

  async updateProgress(auditId, result = {}) {
    const db = await cds.connect.to('db');
    await db.run(
      UPDATE(ENTITY).set({
        ROW_COUNT_TOTAL: result.totalRows ?? 0,
        ROW_COUNT_VALID: result.validCount ?? 0,
        ROW_COUNT_ERROR: result.errorCount ?? 0,
        CHANGED_BY: result.changedBy || '',
        CHANGED_TIMESTAMP: null
      }).where({ AUDIT_ID: auditId })
    );
  }

  async updateResult(auditId, result, fileHash, changedBy, filePath, options = {}) {
    const db = await cds.connect.to('db');
    const statusCode = StatusCodeUtil.normalizeCode(
      options.statusCode || (Number(result.errorCount || 0) ? 'FAILED' : 'COMPLETED'),
      'UNKNOWN_ERROR'
    );

    const payload = {
      FILE_HASH: fileHash || '',
      ROW_COUNT_TOTAL: result.totalRows ?? 0,
      ROW_COUNT_VALID: result.validCount ?? 0,
      ROW_COUNT_ERROR: result.errorCount ?? 0,
      STATUS: StatusCodeUtil.toText(statusCode),
      STATUS_CODE: statusCode,
      ERROR_CODE: options.errorCode ? StatusCodeUtil.normalizeCode(options.errorCode) : '',
      ERROR_DETAIL: String(options.errorDetail || '').slice(0, 500),
      PROCESS_END_AT: DateUtil.nowTimestamp(),
      CHANGED_BY: changedBy || '',
      CHANGED_TIMESTAMP: null
    };

    if (filePath !== undefined) payload.FILE_PATH = filePath;
    await db.run(UPDATE(ENTITY).set(payload).where({ AUDIT_ID: auditId }));
  }

  async markFailed(auditId, errorDetail, changedBy, details = {}) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const failed = StatusCodeUtil.toCode('FAILED');

    const payload = {
      STATUS: StatusCodeUtil.toText(failed),
      STATUS_CODE: failed,
      ERROR_CODE: StatusCodeUtil.normalizeCode(details.errorCode, 'UNKNOWN_ERROR'),
      ERROR_DETAIL: String(errorDetail || '').slice(0, 500),
      PROCESS_END_AT: now,
      CHANGED_BY: changedBy || '',
      CHANGED_TIMESTAMP: null
    };

    const fields = {
      filePath: 'FILE_PATH', fileHash: 'FILE_HASH', sizeBytes: 'FILE_SIZE_BYTES',
      totalRows: 'ROW_COUNT_TOTAL', validCount: 'ROW_COUNT_VALID', errorCount: 'ROW_COUNT_ERROR'
    };
    for (const [source, target] of Object.entries(fields)) {
      if (details[source] !== undefined) payload[target] = details[source];
    }

    await db.run(UPDATE(ENTITY).set(payload).where({ AUDIT_ID: auditId }));
  }
}

module.exports = FileLogRepository;
