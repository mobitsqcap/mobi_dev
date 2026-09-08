'use strict';

/**
 * ConsolidationRepository — HEADER + LINE_ITEM persistence.
 *
 * CONSOLIDATIONHEADER / CONSOLIDATIONLINEITEM expose a single STATUS_CODE :
 * String(3) holding a global 3-digit code from MOBI_DB_STATUS (053=CONSOLIDATION_PENDING,
 * 060=POSTING_PENDING, 061=POSTED, 062=POSTING_FAILED). Error detail text is
 * written to AUDIT.STATUS_MESSAGE only.
 */

const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;

const EntityNames = require('../constants/EntityNames');
const Constants = require('../constants/ConsolidationConstants');
const DateUtil = require('../utils/DateUtil');
const NormalizeUtil = require('../utils/NormalizeUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

const SC_POSTED = Constants.POSTING_STATUS.POSTED;
const SC_POSTING_FAILED = Constants.POSTING_STATUS.POSTING_FAILED;
const SC_POSTING_PENDING = Constants.POSTING_STATUS.POSTING_PENDING;
const SC_CONSOL_PENDING = Constants.POSTING_STATUS.CONSOLIDATION_PENDING;

class ConsolidationRepository {
  async findConsolRefsByPrefix(prefix) {
    const db = await cds.connect.to('db');
    return db.run(
      SELECT.from(EntityNames.CONSOLIDATION_HEADER).columns('CONSOL_REF_ID')
        .where({ CONSOL_REF_ID: { like: `${prefix}%` } })
    );
  }

  async findSapRefsByPrefix(prefix) {
    const db = await cds.connect.to('db');
    return db.run(
      SELECT.from(EntityNames.CONSOLIDATION_HEADER).columns('SAP_REF_DOCUMENT')
        .where({ SAP_REF_DOCUMENT: { like: `${prefix}%` } })
    );
  }

  /**
   * Insert consolidation headers + line items. The run AUDIT_ID is stamped on
   * every header and line item so each document traces back to the consolidation
   * run that created it (join AUDIT_ID -> MOBI_DB_AUDIT). This is the
   * CONSOLIDATION run id; the source transactions keep their own INGESTION
   * AUDIT_ID (which file loaded them).
   */
  async insertDocuments(documents, auditId = null) {
    if (!documents?.length) return { headersInserted: 0, lineItemsInserted: 0 };

    if (!auditId) {
      console.warn(
        '[ConsolidationRepository] insertDocuments called with no auditId — ' +
        'header & line item AUDIT_ID will be NULL. Copy the latest ' +
        'ConsolidationService.js (run() passes runAudit.AUDIT_ID here).'
      );
    }

    const db = await cds.connect.to('db');
    const headers = documents.map((d) => ({ ...d.header, AUDIT_ID: auditId }));
    const lineItems = documents.flatMap((d) =>
      (d.lineItems || []).map((li) => ({ ...li, AUDIT_ID: auditId }))
    );

    await db.run(INSERT.into(EntityNames.CONSOLIDATION_HEADER).entries(headers));

    if (lineItems.length) {
      await db.run(INSERT.into(EntityNames.CONSOLIDATION_LINE_ITEM).entries(lineItems));
    }

    return { headersInserted: headers.length, lineItemsInserted: lineItems.length };
  }

  /**
   * Update HEADER+LINE_ITEM STATUS_CODE and related fields after a posting
   * callback from SAP/CPI.
   *
   * @param {string} consolRefId
   * @param {object} result - { sapRefDocument, postingStatus, httpStatus, errorCode?, errorDetail? }
   * @param {string} changedBy
   */
  async updatePostingResult(consolRefId, result, changedBy = Constants.SYSTEM_USER) {
    if (!consolRefId) throw new Error('CONSOL_REF_ID is required to update posting result');

    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();
    const statusCode = this._normalizeStatusCode(result);

    const existing = await db.run(
      SELECT.one.from(EntityNames.CONSOLIDATION_HEADER)
        .columns('RETRY_COUNT', 'STATUS_CODE', 'SAP_REF_DOCUMENT')
        .where({ CONSOL_REF_ID: consolRefId })
    );

    if (!existing) throw new Error(`Consolidation reference ${consolRefId} not found`);

    const isFailed = statusCode === SC_POSTING_FAILED;
    const sapRef = NormalizeUtil.text(result.sapRefDocument)
      || existing.SAP_REF_DOCUMENT || null;

    const payload = {
      SAP_REF_DOCUMENT: sapRef,
      STATUS_CODE: statusCode,
      POST_DATE: now,
      HTTP_STATUS: result.httpStatus ?? null,
      RETRY_COUNT: isFailed
        ? Number(existing.RETRY_COUNT || 0) + 1
        : Number(existing.RETRY_COUNT || 0)
    };

    await db.run(UPDATE(EntityNames.CONSOLIDATION_HEADER).set(payload).where({ CONSOL_REF_ID: consolRefId }));

    const linePayload = {
      SAP_REF_DOCUMENT: sapRef,
      STATUS_CODE: statusCode,
      POST_DATE: now,
      HTTP_STATUS: result.httpStatus ?? null
    };
    await db.run(UPDATE(EntityNames.CONSOLIDATION_LINE_ITEM).set(linePayload).where({ CONSOL_REF_ID: consolRefId }));

    // Replicate the posting status onto the linked source transactions (matched
    // by CONSOL_REF_ID) so MOBI_DB_TRANSACTION.STATUS_CODE moves to 061/062
    // together with the header/line items — regardless of which handler called
    // this. (CONSOL_REF_ID is stamped on transactions by markPostingPending.)
    await db.run(UPDATE(EntityNames.TRANSACTION).set({
      STATUS_CODE: statusCode
    }).where({ CONSOL_REF_ID: consolRefId }));

    return { consolRefId, statusCode, payload };
  }

  _normalizeStatusCode(result = {}) {
    const raw = result.postingStatus;
    const status = String(raw || '').trim().toUpperCase();

    if (['POSTED', 'SUCCESS', 'S', '03', SC_POSTED].includes(status)) return SC_POSTED;
    if (['POSTING_FAILED', 'FAILED', 'ERROR', 'E', '07', SC_POSTING_FAILED].includes(status)) return SC_POSTING_FAILED;
    if (result.sapRefDocument && !result.errorCode && !result.errorDetail) return SC_POSTED;
    if (['POSTING_PENDING', 'PENDING', '02', SC_POSTING_PENDING].includes(status)) return SC_POSTING_PENDING;
    if (['CONSOLIDATION_PENDING', SC_CONSOL_PENDING].includes(status)) return SC_CONSOL_PENDING;

    if (/^\d{3}$/.test(status) && StatusCodeUtil.toText(status) !== status) {
      return status;
    }

    return SC_POSTING_FAILED;
  }
}

module.exports = ConsolidationRepository;
