// master bp upload srv

const cds = require('@sap/cds');
const { v4: uuid } = require('uuid');
const path = require('path');
const fs = require('fs');

/* ------------------------------------------------------------------ */
/* Locate your master-ingestion folder (works wherever it lives:       */
/*   <project>/master-ingestion   OR   <project>/srv/master-ingestion) */
/* ------------------------------------------------------------------ */
function resolveIngestionBase() {
  const candidates = [
    path.join(__dirname, '..', 'master-ingestion'),
    path.join(__dirname, 'master-ingestion')
  ];
  for (const dir of candidates) {
    if (
      fs.existsSync(path.join(dir, 'utils', 'StatusCodeUtil.js')) &&
      fs.existsSync(path.join(dir, 'services', 'MasterCsvService.js'))
    ) {
      return dir;
    }
  }
  throw new Error(
    '[master-upload-service] Could not locate your master-ingestion folder. ' +
      'Looked for utils/StatusCodeUtil.js + services/MasterCsvService.js at: ' +
      candidates.join(' | ') +
      '. Adjust the paths above to match your project layout.'
  );
}

const INGESTION_BASE = resolveIngestionBase();
const load = (...p) => require(path.join(INGESTION_BASE, ...p));

const Constants = load('utils/Constants');
const StatusCodeUtil = load('utils/StatusCodeUtil');
const HashUtil = load('utils/HashUtil');
const DateUtil = load('utils/DateUtil');
const ErrorMessageUtil = load('utils/ErrorMessageUtil');
const MasterRecord = load('models/MasterRecord');
const MasterValidator = load('services/MasterValidator');
const MasterRepository = load('repositories/MasterRepository');
const FileLogRepository = load('repositories/FileLogRepository');
const AuditRepository = load('repositories/AuditRepository');

const F = StatusCodeUtil.FRIENDLY;

/**
 * MasterUploadService
 *
 * Handles the "Master BP Upload" UI app flow:
 *   - merchants whose BP number was ALREADY created in SAP Public Cloud
 *     are uploaded manually from the freestyle UI5 app (Excel -> UI -> this action)
 *   - records are validated exactly like the SFTP CSV ingestion (MasterValidator)
 *   - PLUS for this flow BP_NUMBER and EXTERNAL_BP_NUMBER are mandatory
 *   - duplicates already present in MOBI_DB_MASTER are REJECTED
 *   - valid records are inserted with STATUS_CODE '063' (BP_CREATED_SUCCESS)
 *     and the BP_NUMBER provided, so CPI will NOT try to create the BP again
 *
 * Audit writes (MOBI_DB_AUDIT) follow the NEW audit table format:
 *   - FILE summary row: AUDIT_LINE_ITEM = 1, PROCESS_TYPE = FILE
 *   - record rows:      AUDIT_LINE_ITEM = 2,3,... (per-file sequence)
 *   - MESSAGE_TYPE:     W / I / E / S (Warning / Info / Error / Success)
 *   - STATUS_MESSAGE:   always includes the FILE NAME
 */
class MasterUploadService {
  constructor({ masterRepository, fileLogRepository, auditRepository } = {}) {
    if (!masterRepository || !fileLogRepository || !auditRepository) {
      throw new Error(
        'MasterUploadService requires { masterRepository, fileLogRepository, auditRepository }. ' +
          'Construct it from cds.service.impl with these dependencies.'
      );
    }
    Object.assign(this, { masterRepository, fileLogRepository, auditRepository });
    this.validator = new MasterValidator();
  }

  /**
   * @param {object} p
   * @param {Array}  p.records   UI payload (DB-style field names, see service .cds)
   * @param {string} p.fileName  uploaded file name (for traceability only)
   * @param {string} [p.actor]   logged in user id
   * @returns summary + per-row errors for the UI table
   */
  async processUpload({ records = [], fileName = 'Master_BP_Upload.xlsx', actor }) {
    if (!records.length) {
      const e = new Error('No records were sent from the app. Please upload a file with at least one data row.');
      e.code = StatusCodeUtil.toCode('EMPTY_FILE', '013');
      throw e;
    }

    const now = DateUtil.nowTimestamp();
    const auditId = uuid();
    const fileId = HashUtil.sha256(`${fileName}|${now}`);
    const fileHash = HashUtil.sha256(JSON.stringify(records));
    // Created-by is ALWAYS the system user for the master flow (audit/filelog/master rows)
    const changedBy = Constants.SYSTEM_USERS.SFTP; // 'SYSTEM_SFTP'

    /* -------------------------------------------------------------- */
    /* 1) Map UI payload -> MasterRecord (same shape as CSV ingestion) */
    /* -------------------------------------------------------------- */
    const mapped = records.map((r, idx) =>
      MasterRecord.fromCsvRow(
        {
          mobi_portal_code: r.MOBI_PORTAL_CODE,
          sap_company_code: r.SAP_COMPANY_CODE,
          id: r.ID,
          external_bp_number: r.EXTERNAL_BP_NUMBER,
          bp_number: r.BP_NUMBER,
          type: r.TYPE,
          name: r.MASTER_NAME,
          address1: r.ADDRESS1,
          postal_code: r.POSTAL_CODE,
          country: r.COUNTRY,
          country_code: r.COUNTRY_CODE,
          business_reg_no_tin: r.BUSINESS_REG_NO_TIN,
          host_name: r.HOST_NAME
        },
        idx + 2 // excel-style row number (row 1 = header)
      )
    );

    /* -------------------------------------------------------------- */
    /* 2) Mandatory for THIS flow: BP_NUMBER + EXTERNAL_BP_NUMBER       */
    /*    (they are optional in the SFTP flow, so checked separately)   */
    /* -------------------------------------------------------------- */
    const extraErrors = [];
    const candidates = [];
    for (const rec of mapped) {
      const missing = [];
      if (!String(rec.EXTERNAL_BP_NUMBER_RAW || rec.EXTERNAL_BP_NUMBER || '').trim()) {
        missing.push(F.missingField('EXTERNAL_BP_NUMBER'));
      }
      if (!String(rec.BP_NUMBER_RAW || rec.BP_NUMBER || '').trim() || String(rec.BP_NUMBER).trim() === ' ') {
        missing.push(F.missingField('BP_NUMBER'));
      }
      if (missing.length) {
        extraErrors.push({
          rowNo: rec._rowNumber,
          mobiReferenceId: rec._rawId || rec.ID || '',
          errorCode: Constants.ERROR_CODES.MANDATORY_FIELD_MISSING,
          errorDetail: missing.join(' ')
        });
      } else {
        candidates.push(rec);
      }
    }

    /* -------------------------------------------------------------- */
    /* 3) Existing-BP duplicate check (portal|company|id composite)     */
    /* -------------------------------------------------------------- */
    const existingIdKeys = await this._loadExistingIdKeys(candidates);

    /* -------------------------------------------------------------- */
    /* 4) Full field validation (same rules as the SFTP ingestion)      */
    /* -------------------------------------------------------------- */
    const { validRecords, errorRows } = this.validator.validateRecords(candidates, { existingIdKeys });
    const allErrors = [...errorRows, ...extraErrors].sort(
      (a, b) => (Number(a.rowNo) || 0) - (Number(b.rowNo) || 0)
    );

    /* -------------------------------------------------------------- */
    /* 5) Insert valid records with STATUS_CODE '063'                   */
    /* -------------------------------------------------------------- */
    let inserted = 0;
    const enriched = validRecords.map((record, index) => {
      const copy = {
        ...record,
        AUDIT_ID: auditId,
        FILE_ID: fileId,
        FILE_NAME: fileName,
        RECORD_NUMBER: index + 1,
        POSTING_STATUS: '01',
        STATUS_CODE: '063',          // BP_CREATED_SUCCESS -> CPI skips these
        BP_CREATION_DATE: now,
        ACTIVE_FLAG: Constants.ACTIVE_FLAG,
        CREATED_BY: changedBy,
        CREATED_TIMESTAMP: now,
        CHANGED_BY: ' '
      };
      // Spread does NOT copy non-enumerable properties; keep the CSV-style row
      // number so the audit rows show the correct "Row N| ..." value.
      Object.defineProperty(copy, '_rowNumber', { value: record._rowNumber, enumerable: false });
      return copy;
    });

    if (enriched.length) {
      try {
        await this.masterRepository.upsertBatch(enriched);
        inserted = enriched.length;
      } catch (upsertErr) {
        // HANA unique constraint (301) => duplicate slipped in
        const msg = String(upsertErr?.message || '').toLowerCase();
        if (upsertErr?.code == 301 || msg.includes('unique constraint') || msg.includes('duplicate')) {
          const sampleId = enriched[0]?.ID || '';
          allErrors.push({
            rowNo: enriched[0]?._rowNumber || 2,
            mobiReferenceId: sampleId,
            errorCode: Constants.ERROR_CODES.DUPLICATE_BP_IN_DATABASE,
            errorDetail: F.duplicateBpInDb(sampleId, '', '')
          });
          inserted = 0;
        } else {
          throw upsertErr;
        }
      }
    }

    const totalRows = mapped.length;
    const validCount = inserted;
    const errorCount = totalRows - inserted;

    /* -------------------------------------------------------------- */
    /* 6) Traceability: FILELOG + AUDIT (summary + record rows)         */
    /* -------------------------------------------------------------- */
    const errorDetail = allErrors.length
      ? ErrorMessageUtil.generateFileErrorSummary(allErrors, totalRows, validCount, errorCount)
      : '';

    try {
      await this.fileLogRepository.createInitial(
        { name: fileName, path: 'UI_UPLOAD/Master BP Upload', sizeBytes: null },
        auditId,
        fileHash,
        null,
        changedBy
      );
      await this.fileLogRepository.updateResult(
        auditId,
        { totalRows, validCount, errorCount },
        fileHash,
        changedBy,
        null,
        { errorDetail }
      );
    } catch (logErr) {
      console.warn(`[MasterUploadService] filelog write failed: ${logErr.message}`);
    }

    try {
      await this.auditRepository.start({
        auditId,
        runId: auditId,
        fileName,
        createdBy: changedBy,
        processName: 'MASTER_BP_UPLOAD',
        processType: 'PORTAL TO BTP'
      });
      await this.auditRepository.complete(
        auditId,
        { totalRows, validCount, errorCount },
        changedBy,
        { errorDetail: errorDetail || undefined, fileName }
      );
      await this.auditRepository.insertRecordRows({
        auditId,
        runId: auditId,
        fileName,
        validRecords: enriched.slice(0, inserted),
        errorRows: allErrors,
        inserted: true,
        processStartAt: now,
        changedBy,
        processName: 'MASTER_BP_UPLOAD',
        processType: 'PORTAL TO BTP'
      });
    } catch (auditErr) {
      console.warn(`[MasterUploadService] audit write failed: ${auditErr.message}`);
    }

    /* -------------------------------------------------------------- */
    /* 7) Result back to the UI                                         */
    /* -------------------------------------------------------------- */
    const message =
      errorCount === 0
        ? `${inserted} record(s) inserted into MOBI_DB_MASTER with STATUS_CODE 063 (BP_CREATED_SUCCESS).`
        : `${inserted} of ${totalRows} record(s) inserted. ${errorCount} record(s) rejected (see errors).`;

    return {
      totalRows,
      validCount,
      errorCount,
      inserted,
      message,
      errors: allErrors.map((e) => ({
        rowNo: Number(e.rowNo) || 0,
        id: String(e.mobiReferenceId || ''),
        errorDetail: String(e.errorDetail || '').substring(0, 500)
      }))
    };
  }

  /** composite-key set (portal|company|id) - same logic as UnifiedIngestionHandler */
  async _loadExistingIdKeys(candidates) {
    const keySet = new Set();
    const ids = [
      ...new Set((candidates || []).map((r) => String(r.ID || '').trim()).filter(Boolean))
    ];
    if (!ids.length) return keySet;
    try {
      const db = await cds.connect.to('db');
      const { SELECT } = cds.ql;
      const rows = await db.run(
        SELECT.from('mobi.db.MOBI_DB_MASTER')
          .columns('MOBI_PORTAL_CODE', 'SAP_COMPANY_CODE', 'ID')
          .where({ ID: { in: ids }, ACTIVE_FLAG: Constants.ACTIVE_FLAG })
      );
      for (const r of rows || []) {
        const portal = String(r.MOBI_PORTAL_CODE || '').trim().toUpperCase();
        const company = String(r.SAP_COMPANY_CODE || '').trim();
        const id = String(r.ID || '').trim().toUpperCase();
        if (portal && company && id) keySet.add(`${portal}|${company}|${id}`);
      }
    } catch (e) {
      console.warn(`[MasterUploadService] existing-key preload failed: ${e.message}`);
    }
    return keySet;
  }
}

/* ------------------------------------------------------------------ */
/* CDS SERVICE WIRING - this is the part that was missing!             */
/* ------------------------------------------------------------------ */
module.exports = cds.service.impl(async function () {
  await StatusCodeUtil.ensureStatusTable();

  // Repositories (reuse the master-ingestion classes)
  const masterRepository = new MasterRepository();
  const fileLogRepository = new FileLogRepository();
  const auditRepository = new AuditRepository();

  // Upload engine (validation + insert + audit)
  const masterUploadService = new MasterUploadService({
    masterRepository,
    fileLogRepository,
    auditRepository
  });

  const actorOf = (req) =>
    req?.user?.id || req?.user?.attr?.email || req?.user?.attr?.user_name || 'UNKNOWN_USER';

  this.on('getStatus', () => 'Master BP upload service is up');

  /**
   * uploadMasterRecords
   * Inserts manually maintained (already-created) BP numbers into
   * MOBI_DB_MASTER with STATUS_CODE '063' so CPI skips them.
   */
  this.on('uploadMasterRecords', async (req) => {
    const { fileName, records } = req.data || {};
    const actor = actorOf(req);

    if (!Array.isArray(records) || records.length === 0) {
      return req.error(400, 'No records provided. Please upload a file with at least one data row.');
    }

    const maxRows = Number(process.env.UI_UPLOAD_MAX_ROWS || 5000);
    if (records.length > maxRows) {
      return req.error(400, `Too many records (${records.length}). Maximum allowed per upload is ${maxRows}.`);
    }

    try {
      const result = await masterUploadService.processUpload({
        records,
        fileName: fileName || 'Master_BP_Upload.xlsx',
        actor
      });
      return result;
    } catch (err) {
      console.error(`[MasterUploadService] uploadMasterRecords failed: ${err.stack || err.message}`);
      return req.error(err.code && /^\d+$/.test(String(err.code)) ? 400 : 500, err.message);
    }
  });
});
