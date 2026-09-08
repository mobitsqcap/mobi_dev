'use strict';


const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;

const EntityNames = require('../constants/EntityNames');
const Constants = require('../constants/ConsolidationConstants');
const DateUtil = require('../utils/DateUtil');
const NormalizeUtil = require('../utils/NormalizeUtil');

class TransactionRepository {
  async findCandidates(scenario, { companyCode, postingDate } = {}) {
    const db = await cds.connect.to('db');

    const retryableStatuses = (scenario.retryableConsolStatuses || Constants.PENDING_CONSOL_STATUSES)
      .map((s) => String(s).trim());

    const DATE_SCOPED_STATUSES = new Set([
      Constants.TXN_STATUS.SUCCESS,
      Constants.CONSOL_STATUS.PENDING
    ]);

    const alwaysRetry = new Set(retryableStatuses.filter((s) => !DATE_SCOPED_STATUSES.has(s)));

    const where = {
      STATUS_CODE: { in: retryableStatuses },
      PAYMENT_TYPE: { in: scenario.paymentTypeAliases },
      PAYMENT_SUB_TYPE: { in: scenario.paymentSubTypeAliases }
    };

    if (companyCode) {
      where.COMPANY_CODE = String(companyCode).trim();
    } else if (scenario.allowedCompanyCodes?.length) {
      where.COMPANY_CODE = { in: scenario.allowedCompanyCodes };
    }

    const rows = await db.run(SELECT.from(EntityNames.TRANSACTION).where(where));

    const requestedDate = DateUtil.dbDate(postingDate);

    return (rows || [])
      .map((r) => this._normalizeRow(r))
      .filter((r) => this._matchesPostingDateOrRetry(r, requestedDate, alwaysRetry))
      .map((r) => this._withPaymentCodes(r))
      .sort((a, b) => this._sortKey(a).localeCompare(this._sortKey(b)));
  }

  _matchesPostingDateOrRetry(row, requestedDate, alwaysRetry) {
    const status = NormalizeUtil.text(row.STATUS_CODE);
    if (alwaysRetry.has(status)) return true;
    if (!requestedDate) return true;
    return DateUtil.dbDate(row.TXN_PAID_DATE) === requestedDate;
  }

  _normalizeRow(row) {
    return {
      ...row,
      COMPANY_CODE: NormalizeUtil.text(row.COMPANY_CODE),
      MOBI_PORTAL_CODE: NormalizeUtil.text(row.MOBI_PORTAL_CODE),
      MOBI_REFERENCE_ID: NormalizeUtil.text(row.MOBI_REFERENCE_ID),
      PAYMENT_TYPE: NormalizeUtil.text(row.PAYMENT_TYPE),
      PAYMENT_SUB_TYPE: NormalizeUtil.text(row.PAYMENT_SUB_TYPE),
      MERCHANT_ID: NormalizeUtil.text(row.MERCHANT_ID),
      HOST_NAME: NormalizeUtil.text(row.HOST_NAME),
      STATUS_CODE: NormalizeUtil.text(row.STATUS_CODE),
      TXN_STATUS: NormalizeUtil.text(row.TXN_STATUS)
    };
  }

  async markPostingPending(records, consolRefId, changedBy) {
    if (!records?.length) return 0;
    return this._updateTransactionGroups(records, {
      STATUS_CODE: Constants.CONSOL_STATUS.POSTING_PENDING,
      CONSOL_REF_ID: consolRefId
    }, changedBy);
  }

  async markRecoverableError(records, consolStatusOrOpts, changedBy) {
    let consolStatus;
    if (consolStatusOrOpts && typeof consolStatusOrOpts === 'object') {
      consolStatus = consolStatusOrOpts.consolStatus;
    } else {
      consolStatus = consolStatusOrOpts;
    }
    if (!records?.length || !consolStatus) return 0;

    const groups = new Map();
    for (const r of records) {
      const k = [r.COMPANY_CODE, r.PAYMENT_TYPE].join('|');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }

    let count = 0;
    for (const recs of groups.values()) {
      count += await this._updateTransactionGroups(recs, {
        STATUS_CODE: consolStatus
      }, changedBy);
    }
    return count;
  }

  async updatePostingResultStatus(consolRefId, postingStatus, changedBy) {
    if (!consolRefId) return 0;

    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();

    const txStatusCode = (String(postingStatus || '').trim() === Constants.POSTING_STATUS.POSTED)
      ? Constants.CONSOL_STATUS.POSTED
      : Constants.CONSOL_STATUS.POSTING_FAILED;

    await db.run(UPDATE(EntityNames.TRANSACTION).set({
      STATUS_CODE: txStatusCode,
      CHANGED_BY: changedBy,
      CHANGED_TIMESTAMP: now
    }).where({ CONSOL_REF_ID: consolRefId }));

    return 1;
  }

  async _updateTransactionGroups(records, payload, changedBy) {
    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();

    const groups = new Map();
    for (const r of records) {
      const k = [r.COMPANY_CODE, r.PAYMENT_TYPE].join('|');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r.MOBI_REFERENCE_ID);
    }

    let count = 0;
    for (const [gk, refs] of groups.entries()) {
      const [companyCode, paymentType] = gk.split('|');
      const unique = [...new Set(refs)].filter(Boolean);

      for (let i = 0; i < unique.length; i += Constants.DB_CHUNK_SIZE) {
        const chunk = unique.slice(i, i + Constants.DB_CHUNK_SIZE);
        await db.run(UPDATE(EntityNames.TRANSACTION).set({
          ...payload,
          CHANGED_BY: changedBy,
          CHANGED_TIMESTAMP: now
        }).where({
          COMPANY_CODE: companyCode,
          PAYMENT_TYPE: paymentType,
          MOBI_REFERENCE_ID: { in: chunk }
        }));
        count += chunk.length;
      }
    }
    return count;
  }

  transactionKey(r) {
    return [r.COMPANY_CODE, r.MOBI_REFERENCE_ID, r.PAYMENT_TYPE].join('|');
  }

  _withPaymentCodes(r) {
    return {
      ...r,
      PAYMENT_TYPE_CODE: NormalizeUtil.paymentCode(r.PAYMENT_TYPE),
      PAYMENT_SUB_TYPE_CODE: NormalizeUtil.paymentCode(r.PAYMENT_SUB_TYPE)
    };
  }

  _sortKey(r) {
    return [
      r.COMPANY_CODE || '', r.MOBI_PORTAL_CODE || '',
      r.TXN_CREATED_DATE || '', r.TXN_CURRENCY || '',
      r.HOST_NAME || '', r.MERCHANT_ID || '', r.MOBI_REFERENCE_ID || ''
    ].join('|');
  }
}

module.exports = TransactionRepository;
