'use strict';

const cds = require('@sap/cds');
const { UPSERT, UPDATE, SELECT, DELETE } = cds.ql;

const DateUtil = require('../utils/DateUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

const ENTITY = 'mobi.db.MOBI_DB_FILEBATCH';

class FileBatchRepository {
  async clearForAttempt(auditId) {
    const db = await cds.connect.to('db');
    await db.run(DELETE.from(ENTITY).where({ AUDIT_ID: auditId }));
  }

  async markStarted(auditId, batchNo, fileName, startIndex, endIndex, totalRecords) {
    const db = await cds.connect.to('db');
    const code = StatusCodeUtil.toCode('PROCESSING');
    const now = DateUtil.nowTimestamp();
    await db.run(
      UPSERT.into(ENTITY).entries({
        AUDIT_ID: auditId,
        BATCH_NO: batchNo,
        FILE_NAME: fileName,
        START_INDEX: startIndex,
        END_INDEX: endIndex,
        STATUS: StatusCodeUtil.toText(code),
        STATUS_CODE: code,
        TOTAL_RECORDS: totalRecords,
        SUCCESS_COUNT: 0,
        ERROR_COUNT: 0,
        START_TIME: now,
        END_TIME: null,
        ERROR_DETAIL: ''
      })
    );
  }

  async markCompleted(auditId, batchNo, successCount, errorCount, errorDetail = '') {
    const db = await cds.connect.to('db');
    const statusName = errorCount === 0
      ? 'SUCCESS'
      : successCount === 0 ? 'FAILED' : 'PARTIALLY_COMPLETED';
    const code = StatusCodeUtil.toCode(statusName);
    await db.run(
      UPDATE(ENTITY).set({
        STATUS: StatusCodeUtil.toText(code),
        STATUS_CODE: code,
        SUCCESS_COUNT: successCount,
        ERROR_COUNT: errorCount,
        END_TIME: DateUtil.nowTimestamp(),
        ERROR_DETAIL: String(errorDetail || '').slice(0, 255)
      }).where({ AUDIT_ID: auditId, BATCH_NO: batchNo })
    );
  }

  async markAllFailed(auditId, errorDetail) {
    const db = await cds.connect.to('db');
    const code = StatusCodeUtil.toCode('FAILED');
    await db.run(
      UPDATE(ENTITY).set({
        STATUS: StatusCodeUtil.toText(code),
        STATUS_CODE: code,
        END_TIME: DateUtil.nowTimestamp(),
        ERROR_DETAIL: String(errorDetail || '').slice(0, 255)
      }).where({ AUDIT_ID: auditId })
    );
  }

  async getSummary(auditId) {
    const db = await cds.connect.to('db');
    const rows = await db.run(
      SELECT.from(ENTITY).columns('SUCCESS_COUNT', 'ERROR_COUNT').where({ AUDIT_ID: auditId })
    );
    return (rows || []).reduce((summary, row) => ({
      validCount: summary.validCount + Number(row.SUCCESS_COUNT || 0),
      errorCount: summary.errorCount + Number(row.ERROR_COUNT || 0)
    }), { validCount: 0, errorCount: 0 });
  }
}

module.exports = FileBatchRepository;
