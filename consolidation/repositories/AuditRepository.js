'use strict';

/**
 * Consolidation AuditRepository — simplified MOBI_DB_AUDIT schema.
 *
 * Columns: AUDIT_ID (UUID, key), AUDIT_LINE_ITEM (Integer, key), PROCESS_NAME,
 * PROCESS_TYPE, MESSAGE_TYPE (S/E/W/I), STATUS_MESSAGE, CREATED_BY,
 * CREATED_TIMESTAMP.
 *
 * One AUDIT_ID UUID is generated per consolidation run and shared by ALL audit
 * rows in that run. AUDIT_LINE_ITEM is a sequential integer (1, 2, 3…) that
 * differentiates rows within the same AUDIT_ID.
 */

const cds = require('@sap/cds');
const { INSERT, UPDATE } = cds.ql;

const EntityNames = require('../constants/EntityNames');
const Constants = require('../constants/ConsolidationConstants');
const DateUtil = require('../utils/DateUtil');
const IdUtil = require('../utils/IdUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

const ENTITY = EntityNames.AUDIT;

class AuditRepository {
  constructor({ softFail = false } = {}) {
    this.softFail = softFail;
    this.lineItemCounters = new Map(); // auditId -> next auditLineItem
  }

  _nextAuditLineItem(auditId) {
    const next = (this.lineItemCounters.get(auditId) || 0) + 1;
    this.lineItemCounters.set(auditId, next);
    return next;
  }

  _messageTypeForStatus(status) {
    const s = String(status || '').toUpperCase();
    if (['COMPLETED', 'SUCCESS', 'POSTED', 'TRANSACTION_SUCCESS', 'POSTING_PENDING'].includes(s)) return 'S';
    if (['FAILED', 'ERROR', 'VALIDATION_FAILED', 'GL_ACCOUNT_MISSING', 'MERCHANT_BP_MISSING',
         'HOST_BP_MISSING', 'BP_MASTER_MISSING', 'CONSOLIDATION_FAILED', 'POSTING_FAILED'].includes(s)) return 'E';
    if (['PARTIAL', 'PARTIALLY_COMPLETED'].includes(s)) return 'W';
    return 'I';
  }

  // ---- Run lifecycle ----

  async createRun({
    auditId = null, scenarioCode, status = 'STARTED',
    totalRecords = 0, successCount = 0, errorCount = 0,
    errorCode = null, errorDetail = null,
    companyCode = null, paymentType = null, paymentSubType = null,
    changedBy = Constants.SYSTEM_USER
  }) {
    const id = auditId || IdUtil.uuid();
    this.lineItemCounters.set(id, 0);
    const lineItemNo = this._nextAuditLineItem(id);
    const now = DateUtil.nowTimestamp();
    const messageType = this._messageTypeForStatus(status);

    const parts = [`Scenario=${scenarioCode || 'RUN'}`];
    if (companyCode) parts.push(`company=${companyCode}`);
    if (paymentType) parts.push(`type=${paymentType}`);
    if (totalRecords) parts.push(`total=${totalRecords}, success=${successCount}, errors=${errorCount}`);
    const message = String(errorDetail || parts.join(', ')).substring(0, 500);

    await this._insert([{
      AUDIT_ID: id,
      AUDIT_LINE_ITEM: lineItemNo,
      PROCESS_NAME: 'CONSOLIDATION',
      PROCESS_TYPE: scenarioCode || 'CONSOLIDATION',
      MESSAGE_TYPE: messageType,
      STATUS_MESSAGE: message,
      CREATED_BY: changedBy,
      CREATED_TIMESTAMP: now
    }]);

    return { AUDIT_ID: id };
  }

  async completeRun(auditId, {
    status, totalRecords, successCount, errorCount,
    errorCode = null, errorDetail = null, consolRefIds = null, changedBy
  }) {
    if (!auditId) return null;
    return this._safe(async () => {
      const db = await cds.connect.to('db');
      const messageType = this._messageTypeForStatus(status);
      const message = buildRunCompletionMessage({
        status,
        total: totalRecords,
        success: successCount,
        errors: errorCount,
        errorCode,
        errorDetail,
        consolRefIds
      }).substring(0, 500);

      await db.run(UPDATE(ENTITY).set({
        MESSAGE_TYPE: messageType,
        STATUS_MESSAGE: message
      }).where({ AUDIT_ID: auditId, AUDIT_LINE_ITEM: 1 }));

      return { AUDIT_ID: auditId, MESSAGE_TYPE: messageType };
    });
  }

  // ---- Per-record / per-document rows ----

  async insertTransactionErrors({
    auditId, scenarioCode, records,
    errorCodeByTransaction = new Map(),
    errorDetailByTransaction = new Map(),
    defaultErrorCode, defaultStatus = 'FAILED',
    changedBy
  }) {
    if (!records?.length || !auditId) return 0;

    const now = DateUtil.nowTimestamp();
    const entries = records.map((r) => {
      const key = [r.COMPANY_CODE, r.MOBI_REFERENCE_ID, r.PAYMENT_TYPE].join('|');
      const logicalCode = errorCodeByTransaction.get(key) || defaultErrorCode;
      const detail = errorDetailByTransaction.get(key)
        || (logicalCode ? `${logicalCode}` : 'Error');
      return {
        AUDIT_ID: auditId,
        AUDIT_LINE_ITEM: this._nextAuditLineItem(auditId),
        PROCESS_NAME: 'CONSOLIDATION',
        PROCESS_TYPE: consolProcessType(scenarioCode),
        MESSAGE_TYPE: 'E',
        STATUS_MESSAGE: `CONSOLIDATION FAILED (${String(detail).substring(0, 450)})`,
        CREATED_BY: changedBy,
        CREATED_TIMESTAMP: now
      };
    });

    await this._insert(entries);
    return entries.length;
  }

  async insertDocumentSuccesses({
    auditId, scenarioCode, documents, changedBy
  }) {
    if (!documents?.length || !auditId) return 0;

    const now = DateUtil.nowTimestamp();
    const processType = consolProcessType(scenarioCode);
    const entries = [];

    for (const doc of documents) {
      const header = doc.header || {};
      const sources = doc.sourceTransactions || [];
      for (const src of sources) {
        entries.push({
          AUDIT_ID: auditId,
          AUDIT_LINE_ITEM: this._nextAuditLineItem(auditId),
          PROCESS_NAME: 'CONSOLIDATION',
          PROCESS_TYPE: processType,
          MESSAGE_TYPE: 'S',
          STATUS_MESSAGE: `POSTING PENDING (${header.CONSOL_REF_ID || ''})`.substring(0, 500),
          CREATED_BY: changedBy,
          CREATED_TIMESTAMP: now
        });
      }
    }

    await this._insert(entries);
    return entries.length;
  }

  // ---- Posting result (INTEGRATION / CPI TO SAP) ----

  async applyPostingResult({
    consolRefId, postingStatus, errorCode = null,
    errorDetail = null, sapRefDocument = null, changedBy
  }) {
    if (!consolRefId) return { inserted: 0 };

    const auditId = IdUtil.uuid();
    this.lineItemCounters.set(auditId, 0);
    const lineItemNo = this._nextAuditLineItem(auditId);
    const now = DateUtil.nowTimestamp();

    const statusText = String(postingStatus || '').trim().toUpperCase();
    const isPosted = ['061', 'POSTED'].includes(statusText);
    const messageType = isPosted ? 'S' : 'E';
    const message = isPosted
      ? `POSTED (Consol Ref: ${consolRefId}, SAP Document: ${sapRefDocument || 'N/A'})`
      : `POSTING FAILED (Consol Ref: ${consolRefId}, Reason: ${String(errorDetail || errorCode || 'Unknown error').substring(0, 350)})`;

    await this._insert([{
      AUDIT_ID: auditId,
      AUDIT_LINE_ITEM: lineItemNo,
      PROCESS_NAME: 'INTEGRATION',
      PROCESS_TYPE: 'CPI TO SAP',
      MESSAGE_TYPE: messageType,
      STATUS_MESSAGE: message.substring(0, 500),
      CREATED_BY: changedBy,
      CREATED_TIMESTAMP: now
    }]);

    return { inserted: 1, messageType };
  }

  // ---- PATCH audit ----

  async updatePatchAudit({ auditId = null, consolRefId, docRefItem, changedFields, changedBy }) {
    const id = auditId || IdUtil.uuid();
    if (!this.lineItemCounters.has(id)) this.lineItemCounters.set(id, 0);
    const lineItemNo = this._nextAuditLineItem(id);
    const now = DateUtil.nowTimestamp();

    await this._insert([{
      AUDIT_ID: id,
      AUDIT_LINE_ITEM: lineItemNo,
      PROCESS_NAME: 'CONSOLIDATION',
      PROCESS_TYPE: 'PATCH',
      MESSAGE_TYPE: 'I',
      STATUS_MESSAGE: `Line item ${docRefItem} patched: ${Object.keys(changedFields || {}).join(', ')}`.substring(0, 500),
      CREATED_BY: changedBy,
      CREATED_TIMESTAMP: now
    }]);

    return { inserted: true };
  }

  // ---- Internal helpers ----

  async _insert(entries) {
    if (!entries?.length) return;
    return this._safe(async () => {
      const db = await cds.connect.to('db');
      for (let i = 0; i < entries.length; i += 200) {
        await db.run(INSERT.into(ENTITY).entries(entries.slice(i, i + 200)));
      }
    });
  }

  async _safe(fn) {
    try { return await fn(); }
    catch (error) {
      console.error('[AuditRepository]', error.stack || error.message);
      if (!this.softFail) throw error;
      return null;
    }
  }
}

// ---- Module-local helpers ----

function consolProcessType(scenarioCode) {
  if (scenarioCode === 'DOMESTIC_SETTLEMENT') return 'DOMESTIC';
  return scenarioCode || 'CONSOLIDATION';
}

function buildRunCompletionMessage({ status, total, success, errors, errorCode, errorDetail, consolRefIds }) {
  const s = String(status || '').toUpperCase();
  const refList = formatConsolRefIds(consolRefIds);
  const reason = reasonText(errorCode, errorDetail);

  let base;

  if (s === 'SUCCESS' || s === 'COMPLETED') {
    if ((success || 0) === 0) {
      base = reason
        ? `Consolidation completed: no transactions consolidated. ${reason}`
        : 'Consolidation completed: no transactions consolidated';
    } else {
      base = `Consolidation completed: ${success || 0} of ${total || 0} record(s) consolidated`;
    }
  } else if (s === 'PARTIAL' || s === 'PARTIALLY_COMPLETED') {
    const head = (success || 0) === 0
      ? `Consolidation blocked: ${errors || 0} of ${total || 0} record(s) failed (all-or-nothing)`
      : `Consolidation partial: ${success || 0} consolidated, ${errors || 0} failed of ${total || 0} record(s)`;
    base = `${head}. Reason: ${reason}`;
  } else if (s === 'ERROR' || s === 'FAILED') {
    base = `Consolidation failed: 0 of ${total || 0} record(s) consolidated. Reason: ${reason}`;
  } else {
    base = `Consolidation run ended (${status})`;
  }

  return refList
    ? `${base}(${refList})`
    : `${base}.`;
}

function reasonText(errorCode, errorDetail) {
  const detail = String(errorDetail || '').trim().replace(/[.\s]+$/, '');
  if (detail) return detail;
  const code = String(errorCode || '').trim();
  return code || 'Unknown';
}

function formatConsolRefIds(consolRefIds) {
  if (!consolRefIds) return '';
  const arr = Array.isArray(consolRefIds)
    ? consolRefIds.filter(Boolean)
    : String(consolRefIds).split(',').map((s) => s.trim()).filter(Boolean);
  if (!arr.length) return '';

  const shown = [];
  let len = 0;
  for (const ref of arr) {
    const add = (shown.length ? ', ' : '') + ref;
    if (len + add.length > 300) break;
    shown.push(ref);
    len += add.length;
  }
  if (shown.length < arr.length) {
    return `${shown.join(', ')}, ... (+${arr.length - shown.length} more)`;
  }
  return shown.join(', ');
}

module.exports = AuditRepository;
