const cds = require('@sap/cds');
const { UPSERT, UPDATE, INSERT, SELECT } = cds.ql;
const { v4: uuid } = require('uuid');
const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');
const {
  MESS,
  safe,
  fileSummaryMessage,
  processingMessage,
  receivedMessage,
  recordInsertedMessage,
  recordErrorMessage,
  cpiSuccessMessage,
  cpiErrorMessage,
  failedMessage
} = require('../utils/AuditMessType');

/**
 * AuditRepository (master ingestion)
 *
 * NEW MOBI_DB_AUDIT structure (per the new audit table spec):
 *   - AUDIT_ID          : UUID     - SHARED for every row of a file
 *                                    (= the file's AUDIT_ID from MOBI_DB_FILELOG)
 *   - AUDIT_LINE_ITEM        : Integer  - 1 = FILE summary row, 2,3,... = record rows
 *   - PROCESS_NAME      : String(50)  (MASTER_INGESTION / INTEGRATION / ...)
 *   - PROCESS_TYPE      : String(20)  (FILE / SFTP TO BTP / CPI TO SAP / ...)
 *   - MESSAGE_TYPE         : String(1)   (W = Warning / I = Info / E = Error / S = Success)
 *   - STATUS_MESSAGE    : String(500) (always includes the FILE NAME, resolved
 *                                      from MOBI_DB_FILELOG by AUDIT_ID)
 *   - CREATED_BY        : String(50)
 *   - CREATED_TIMESTAMP : Timestamp
 *
 * Removed columns (no longer written): STATUS_CODE, OBJECT_ID, OBJECT_NAME,
 * START_TIME, END_TIME.
 *
 * MESSAGE_TYPE is ALWAYS explicitly set on every write (never left null).
 */
class AuditRepository {
  _text(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  _now() {
    return DateUtil.nowTimestamp();
  }

  /**
   * Resolve the FILE_NAME for an AUDIT_ID from MOBI_DB_FILELOG.
   * Called automatically so callers don't have to pass the file name everywhere.
   */
  async _fileNameFor(db, auditId) {
    if (!auditId) return '';
    try {
      const rows = await db.run(
        SELECT.from('mobi.db.MOBI_DB_FILELOG')
          .columns('FILE_NAME')
          .where({ AUDIT_ID: auditId })
          .limit(1)
      );
      return (rows && rows[0] && rows[0].FILE_NAME) || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Next AUDIT_LINE_ITEM for a file's AUDIT_ID (per-file integer sequence).
   * The FILE summary row always has AUDIT_LINE_ITEM = 1 (created by start()),
   * record rows continue from 2, 3, ...
   */
  async _nextProcessId(db, auditId) {
    if (!auditId) return 2;
    const rows = await db.run(
      SELECT.from('mobi.db.MOBI_DB_AUDIT')
        .columns('AUDIT_LINE_ITEM')
        .where({ AUDIT_ID: auditId })
        .orderBy('AUDIT_LINE_ITEM desc')
        .limit(1)
    );
    const max = rows && rows.length ? Number(rows[0].AUDIT_LINE_ITEM || 0) : 0;
    return Math.max(1, max) + 1; // 1 is reserved for the FILE summary row
  }

  // ------------------------------------------------------------------
  // FILE-LEVEL SUMMARY ROW ( AUDIT_LINE_ITEM = 1, PROCESS_TYPE = FILE )
  // ------------------------------------------------------------------

  /**
   * Creates the file-level summary row.
   * e.g. MASTER_INGESTION | FILE | I | "File Master_20260806.csv received. Processing started."
   */
  async start({
    auditId,
    runId,
    fileName,
    createdBy,
    details = {},
    processName = 'MASTER_INGESTION',
    processType = 'FILE'
  }) {
    const db = await cds.connect.to('db');
    const now = this._now();
    const entry = {
      AUDIT_ID: auditId || uuid(),
      AUDIT_LINE_ITEM: 1,
      PROCESS_NAME: this._text(processName || 'MASTER_INGESTION').substring(0, 50),
      PROCESS_TYPE: this._text(processType || 'FILE').substring(0, 20),
      MESSAGE_TYPE: safe('INFO'),
      STATUS_MESSAGE: receivedMessage(fileName).substring(0, 500),
      CREATED_BY: this._text(createdBy || Constants.SYSTEM_USERS.SFTP).substring(0, 50),
      CREATED_TIMESTAMP: now
    };
    await db.run(UPSERT.into('mobi.db.MOBI_DB_AUDIT').entries(entry));
    return entry;
  }

  /** Interim progress on the FILE summary row. */
  async updateProgress(auditId, stats = {}, changedBy, details = {}) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    const fileName = details.fileName || (await this._fileNameFor(db, auditId));
    const msg = processingMessage(stats.validCount, stats.errorCount, stats.totalRows, fileName);
    await db.run(
      UPDATE('mobi.db.MOBI_DB_AUDIT')
        .set({
          MESSAGE_TYPE: safe('INFO'),
          STATUS_MESSAGE: msg.substring(0, 500)
        })
        .where({ AUDIT_ID: auditId, AUDIT_LINE_ITEM: 1 })
    );
  }

  /**
   * Final state of the FILE summary row.
   * MESSAGE_TYPE: W (Warning) when errors > 0 (as in the Excel), otherwise S (Success).
   * Message always includes the file name.
   */
  async complete(auditId, result, changedBy, options = {}) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    const total = Number(result.totalRows || 0);
    const valid = Number(result.validCount || 0);
    const errors = Number(result.errorCount || 0);
    const messType = errors > 0 ? safe('WARNING') : safe('SUCCESS');
    const fileName = options.fileName || (await this._fileNameFor(db, auditId));
    const msg = options.statusMessage || fileSummaryMessage(total, valid, errors, fileName);
    await db.run(
      UPDATE('mobi.db.MOBI_DB_AUDIT')
        .set({
          MESSAGE_TYPE: messType,
          STATUS_MESSAGE: msg.substring(0, 500)
        })
        .where({ AUDIT_ID: auditId, AUDIT_LINE_ITEM: 1 })
    );
  }

  /** Failure state of the FILE summary row. */
  async fail(auditId, error, counts = {}, changedBy, details = {}) {
    if (!auditId) return;
    const db = await cds.connect.to('db');
    const errorDetail =
      details.errorDetail !== undefined
        ? this._text(details.errorDetail)
        : this._text((error && error.message) || 'File processing failed');
    const fileName = details.fileName || (await this._fileNameFor(db, auditId));
    await db.run(
      UPDATE('mobi.db.MOBI_DB_AUDIT')
        .set({
          MESSAGE_TYPE: safe('ERROR'),
          STATUS_MESSAGE: failedMessage(fileName, errorDetail).substring(0, 500)
        })
        .where({ AUDIT_ID: auditId, AUDIT_LINE_ITEM: 1 })
    );
  }

  // ------------------------------------------------------------------
  // RECORD INGESTION ROWS ( PROCESS_TYPE = SFTP TO BTP )
  // ------------------------------------------------------------------

  /**
   * Record-level rows for one file.
   * e.g. MASTER_INGESTION | SFTP TO BTP | S | "Row 3| Data Inserted | File: Master_20260806.csv"
   *      MASTER_INGESTION | SFTP TO BTP | E | "Row 2| Error Detail | File: Master_20260806.csv"
   *
   * @param {object}   opts.auditId       file's AUDIT_ID (from MOBI_DB_FILELOG) - REQUIRED for the new model
   * @param {string}   [opts.fileName]    file name (auto-resolved from FILELOG when omitted)
   * @param {string}   [opts.processName] default 'MASTER_INGESTION'
   * @param {string}   [opts.processType] default 'SFTP TO BTP'
   */
  async insertRecordRows({
    auditId,
    runId,
    fileName,
    validRecords = [],
    errorRows = [],
    inserted = true,
    errorFilePath = null,
    processStartAt = null,
    changedBy = Constants.SYSTEM_USERS.SFTP,
    processName = 'MASTER_INGESTION',
    processType = 'SFTP TO BTP'
  }) {
    if (!validRecords.length && !errorRows.length) return 0;
    const db = await cds.connect.to('db');
    const now = this._now();
    const fileAuditId = auditId || uuid(); // fallback only - callers should always pass the file audit id
    const file = fileName || (await this._fileNameFor(db, fileAuditId));
    let nextId = await this._nextProcessId(db, fileAuditId);
    const entries = [];

    // ---- valid records (inserted / skipped) -------------------------
    for (const r of validRecords) {
      const rowNo = r._rowNumber || r.ROW_NO || r.rowNo || '';
      entries.push({
        AUDIT_ID: fileAuditId,
        AUDIT_LINE_ITEM: nextId++,
        PROCESS_NAME: this._text(processName || 'MASTER_INGESTION').substring(0, 50),
        PROCESS_TYPE: this._text(processType || 'SFTP TO BTP').substring(0, 20),
        MESSAGE_TYPE: inserted ? safe('SUCCESS') : safe('WARNING'),
        STATUS_MESSAGE: (
          inserted
            ? recordInsertedMessage(rowNo, r.ID, r.MASTER_NAME, file)
            : `Row ${rowNo || ''}| Data Skipped${file ? ` | File: ${file}` : ''}`
        ).substring(0, 500),
        CREATED_BY: this._text(changedBy || Constants.SYSTEM_USERS.SFTP).substring(0, 50),
        CREATED_TIMESTAMP: now
      });
    }

    // ---- error rows --------------------------------------------------
    for (const e of errorRows) {
      const detail = this._text(e.errorDetail || e.detail || '');
      entries.push({
        AUDIT_ID: fileAuditId,
        AUDIT_LINE_ITEM: nextId++,
        PROCESS_NAME: this._text(processName || 'MASTER_INGESTION').substring(0, 50),
        PROCESS_TYPE: this._text(processType || 'SFTP TO BTP').substring(0, 20),
        MESSAGE_TYPE: safe('ERROR'),
        STATUS_MESSAGE: recordErrorMessage(e.rowNo || '', detail, file).substring(0, 500),
        CREATED_BY: this._text(changedBy || Constants.SYSTEM_USERS.SFTP).substring(0, 50),
        CREATED_TIMESTAMP: now
      });
    }

    const chunkSize = Number(process.env.AUDIT_CHUNK_SIZE || 500);
    let written = 0;
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      try {
        await db.run(INSERT.into('mobi.db.MOBI_DB_AUDIT').entries(chunk));
        written += chunk.length;
      } catch (err) {
        console.error(`[AuditRepository] record rows ${i}-${i + chunk.length} failed: ${err.message}`);
      }
    }
    return written;
  }

  // ------------------------------------------------------------------
  // CPI TO SAP STATUS REPLICATION ( PROCESS_NAME = INTEGRATION )
  // ------------------------------------------------------------------

  /**
   * Creates record rows for CPI results.
   * e.g. INTEGRATION | CPI TO SAP | S | "Row 1| 60000571 created successfully for 2201 | File: Master_20260806.csv"
   *      INTEGRATION | CPI TO SAP | E | "Row 3| Error Passed by CPI | File: Master_20260806.csv"
   *
   * NOTE: the FILE summary row (AUDIT_LINE_ITEM = 1) is intentionally NOT touched here -
   * its STATUS_MESSAGE stays as the ingestion result.
   */
  async createRecordAuditFromCPIBatch(items) {
    if (!items || !items.length) return 0;
    const db = await cds.connect.to('db');
    const now = this._now();

    // Preload master rows to resolve the file AUDIT_ID, BP number and row number
    const ids = [...new Set((items || []).map((i) => i.ID).filter(Boolean))];
    const masterMap = new Map();
    if (ids.length) {
      try {
        const rows = await db.run(
          SELECT.from('mobi.db.MOBI_DB_MASTER')
            .columns('ID', 'EXTERNAL_BP_NUMBER', 'MASTER_NAME', 'AUDIT_ID', 'RECORD_NUMBER', 'FILE_NAME')
            .where({ ID: { in: ids } })
        );
        for (const r of rows || []) {
          masterMap.set(r.ID, r);
        }
      } catch (e) {
        console.warn('[AuditRepository] Could not preload master map for CPI audit:', e.message);
      }
    }

    // Group items by target file AUDIT_ID so the AUDIT_LINE_ITEM sequence stays per file
    const groups = new Map(); // fileAuditId -> { entries: [] }
    for (const item of items) {
      const masterRow = masterMap.get(item.ID);
      const fileAuditId = item.AUDIT_ID || (masterRow && masterRow.AUDIT_ID) || uuid();
      const bp = String(item.BP_NUMBER || '').trim();
      const isSuccess = (bp.length > 0 && bp.toLowerCase() !== 'null') || item.STATUS_CODE === '063';
      const rowNo =
        item.RECORD_NUMBER || item.rowNo || item.ROW_NO || (masterRow && masterRow.RECORD_NUMBER) || '';
      const detail = String(item.ERROR_DETAIL || item.ERROR_MESSAGE || item.ERROR_CODE || '').trim();
      const fileName =
        item.FILE_NAME || (masterRow && masterRow.FILE_NAME) || '';
      const externalBp = String(
        item.EXTERNAL_BP_NUMBER || (masterRow && masterRow.EXTERNAL_BP_NUMBER) || item.ID || ''
      ).trim();

      const entry = {
        AUDIT_ID: fileAuditId,
        AUDIT_LINE_ITEM: 0, // assigned after grouping (per-file sequence)
        PROCESS_NAME: 'INTEGRATION',
        PROCESS_TYPE: 'CPI TO SAP',
        MESSAGE_TYPE: isSuccess ? safe('SUCCESS') : safe('ERROR'),
        STATUS_MESSAGE: (
          isSuccess
            ? cpiSuccessMessage(rowNo, bp, externalBp, fileName)
            : cpiErrorMessage(rowNo, detail, fileName)
        ).substring(0, 500),
        CREATED_BY: String(item.CREATED_BY || 'CPI_SYSTEM').substring(0, 50),
        CREATED_TIMESTAMP: now
      };

      if (!groups.has(fileAuditId)) {
        groups.set(fileAuditId, { entries: [] });
      }
      groups.get(fileAuditId).entries.push(entry);
    }

    let written = 0;
    const chunkSize = Number(process.env.AUDIT_CHUNK_SIZE || 500);

    for (const [fileAuditId, g] of groups) {
      let nextId = await this._nextProcessId(db, fileAuditId);
      const all = g.entries.map((e) => ({ ...e, AUDIT_LINE_ITEM: nextId++ }));

      for (let i = 0; i < all.length; i += chunkSize) {
        const chunk = all.slice(i, i + chunkSize);
        try {
          await db.run(INSERT.into('mobi.db.MOBI_DB_AUDIT').entries(chunk));
          written += chunk.length;
        } catch (err) {
          console.error(`[AuditRepository] CPI audit insertion failed for chunk ${i}: ${err.message}`);
        }
      }
    }

    return written;
  }

  async updateRecordAuditFromMasterBatch(items) {
    return this.createRecordAuditFromCPIBatch(items);
  }

  async updateRecordAuditFromMaster(item) {
    if (!item) return 0;
    return this.createRecordAuditFromCPIBatch([item]);
  }

  async insertRecordErrors({
    auditId,
    runId,
    fileName,
    errorRows,
    processStartAt,
    changedBy,
    errorFilePath = null,
    processName,
    processType
  }) {
    return this.insertRecordRows({
      auditId,
      runId,
      fileName,
      validRecords: [],
      errorRows: errorRows || [],
      inserted: false,
      errorFilePath,
      processStartAt,
      changedBy,
      processName,
      processType
    });
  }
}

module.exports = AuditRepository;
