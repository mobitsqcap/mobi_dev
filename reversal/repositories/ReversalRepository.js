'use strict';

const cds = require('@sap/cds');
const { SELECT, INSERT, DELETE } = cds.ql;

const Constants = require('../constants/ReversalConstants');
const { normalizeDocument } = require('../utils/DocumentUtil');

const ACTIVE_TRANSACTION = 'mobi.db.MOBI_DB_TRANSACTION';
const ACTIVE_HEADER = 'mobi.db.MOBI_DB_CONSOLIDATIONHEADER';
const ACTIVE_LINE = 'mobi.db.MOBI_DB_CONSOLIDATIONLINEITEM';
const HISTORY_TRANSACTION = 'mobi.db.MOBI_DB_TRANSACTION_REVERSAL';
const HISTORY_HEADER = 'mobi.db.MOBI_DB_CONSOLIDATIONHEADER_REVERSAL';
const HISTORY_LINE = 'mobi.db.MOBI_DB_CONSOLIDATIONLINEITEM_REVERSAL';

function lock(query) {
  // CAP/HANA supports FOR UPDATE. Keeping the guard makes local SQLite tests
  // usable as well, where the query builder may not expose it.
  return typeof query.forUpdate === 'function' ? query.forUpdate() : query;
}

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function dateOnly(value) {
  const raw = text(value);
  if (!raw) return null;
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  // SAP Gateway OData V2 may serialize Edm.DateTime as /Date(....)/.
  const sapDateMatch = raw.match(/^\/Date\(([-]?\d+)/);
  if (sapDateMatch) {
    const parsed = new Date(Number(sapDateMatch[1]));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function status(value) {
  return text(value).padStart(3, '0');
}

class ReversalRepository {
  async findActiveHeaders(tx, companyCode, originalDocument) {
    const exact = await tx.run(lock(
      SELECT.from(ACTIVE_HEADER)
        .where({ COMPANY_CODE: companyCode, SAP_REF_DOCUMENT: originalDocument })
    ));
    if (exact.length) return exact;

    // SAP and BTP can represent the same accounting document with different
    // leading-zero padding. Apply numeric document comparison after the
    // company-code restriction, while keeping the rows locked.
    const candidates = await tx.run(lock(
      SELECT.from(ACTIVE_HEADER).where({ COMPANY_CODE: companyCode })
    ));
    const documentKey = normalizeDocument(originalDocument);
    return candidates.filter((row) => normalizeDocument(row.SAP_REF_DOCUMENT) === documentKey);
  }

  async findHistoryHeaders(tx, companyCode, originalDocument) {
    const candidates = await tx.run(
      SELECT.from(HISTORY_HEADER).where({ COMPANY_CODE: companyCode })
    );
    const documentKey = normalizeDocument(originalDocument);
    return candidates.filter((row) => normalizeDocument(row.SAP_REF_DOCUMENT) === documentKey);
  }

  async loadActiveGroup(tx, header) {
    const where = { CONSOL_REF_ID: header.CONSOL_REF_ID };
    const txWhere = {
      COMPANY_CODE: header.COMPANY_CODE,
      CONSOL_REF_ID: header.CONSOL_REF_ID
    };

    const [transactions, lines] = await Promise.all([
      tx.run(lock(SELECT.from(ACTIVE_TRANSACTION).where(txWhere))),
      tx.run(lock(SELECT.from(ACTIVE_LINE).where(where)))
    ]);

    return {
      header,
      transactions: transactions || [],
      lines: lines || []
    };
  }

  async archiveAndDelete(tx, group, sapReversal, reversalAuditId) {
    const now = new Date().toISOString();
    const reversalDocument = text(sapReversal.AccountingDocument);
    const reversalReason = text(sapReversal.ReversalReason) || null;
    const reversalDate = dateOnly(sapReversal.LastChangeDate);
    if (!reversalAuditId) throw new Error('REVERSAL_MOVE_FAILED: reversal audit id is required');

    const transactionRows = group.transactions.map((row) => ({
      ...this._pick(row, [
        'COMPANY_CODE', 'MOBI_REFERENCE_ID', 'PAYMENT_TYPE',
        'MOBI_PORTAL_CODE', 'MERCHANT_ID', 'MERCHANT_TYPE', 'MERCHANT_NAME',
        'TXN_CREATED_DATE', 'TXN_PAID_DATE', 'TXN_CREATED_TIME', 'TXN_PAID_TIME',
        'TIME_ZONE', 'PAYMENT_SUB_TYPE', 'PAYMENT_METHOD', 'HOST_NAME',
        'TXN_CURRENCY', 'TXN_AMOUNT', 'HOST_MDR_AMOUNT', 'HOST_FEE_PAYABLE',
        'MOBI_MDR_AMOUNT', 'MDR_REVENUE', 'AR_PAYIN', 'AP_PAYIN', 'AP_PAYOUT',
        'HOST_REFERENCE_ID', 'MERCHANT_REFERENCE_ID', 'TXN_STATUS',
        'BALANCE_CHECK', 'ORIGINAL_AMOUNT', 'SETTLED_IN_CURRENCY',
        'CONVERSION_RATE', 'COUNTRY_CODE', 'CONSOL_REF_ID', 'CREATED_BY',
        'CREATED_TIMESTAMP', 'CHANGED_BY', 'CHANGED_TIMESTAMP'
      ]),
      AUDIT_ID: reversalAuditId,
      STATUS_CODE: Constants.REVERSED_STATUS,
      REVERSAL_DOCUMENT: reversalDocument,
      REVERSAL_REASON: reversalReason,
      REVERSAL_DATE: reversalDate
    }));

    const headerRow = {
      ...this._pick(group.header, [
        'CONSOL_REF_ID', 'SAP_REF_DOCUMENT', 'COMPANY_CODE',
        'MOBI_PORTAL_CODE', 'PAYMENT_TYPE', 'PAYMENT_SUB_TYPE',
        'DOCUMENT_TYPE', 'POSTING_DATE', 'DOCUMENT_DATE', 'BASELINE_DATE',
        'TOTAL_DEBIT_AMOUNT', 'TOTAL_CREDIT_AMOUNT', 'CURRENCY', 'POST_DATE',
        'HTTP_STATUS', 'RETRY_COUNT', 'CREATED_BY', 'CREATED_TIMESTAMP',
        'CHANGED_BY', 'CHANGED_TIMESTAMP'
      ]),
      AUDIT_ID: reversalAuditId,
      STATUS_CODE: Constants.REVERSED_STATUS,
      REVERSAL_DOCUMENT: reversalDocument,
      REVERSAL_REASON: reversalReason,
      REVERSAL_DATE: reversalDate
    };

    const lineRows = group.lines.map((row) => ({
      ...this._pick(row, [
        'CONSOL_REF_ID', 'DOC_REF_ITEM', 'SAP_REF_DOCUMENT',
        'COMPANY_CODE', 'MOBI_PORTAL_CODE', 'PAYMENT_TYPE',
        'PAYMENT_SUB_TYPE', 'MERCHANT_ID', 'SAP_SUPPLIER_NUMBER',
        'SAP_CUSTOMER_NUMBER', 'POSTING_DATE', 'DOCUMENT_DATE',
        'BASELINE_DATE', 'HOST_NAME', 'CURRENCY', 'HOST_MDR_AMOUNT',
        'HOST_FEE_PAYABLE', 'MDR_REVENUE', 'AR_PAYIN', 'AP_PAYIN',
        'AP_PAYOUT', 'TRANSACTION_AMOUNT', 'GL_ACCOUNT',
        'DEBIT_CREDIT_INDICATOR', 'COST_CENTER', 'PROFIT_CENTER',
        'DOCUMENT_TYPE', 'POST_DATE', 'HTTP_STATUS', 'RETRY_COUNT',
        'CREATED_BY', 'CREATED_TIMESTAMP', 'CHANGED_BY', 'CHANGED_TIMESTAMP'
      ]),
      AUDIT_ID: reversalAuditId,
      STATUS_CODE: Constants.REVERSED_STATUS,
      REVERSAL_DOCUMENT: reversalDocument,
      REVERSAL_REASON: reversalReason,
      REVERSAL_DATE: reversalDate
    }));

    // Insert complete snapshots first. If any insert fails, the surrounding
    // CAP transaction rolls back and active rows are left untouched.
    await tx.run(INSERT.into(HISTORY_TRANSACTION).entries(transactionRows));
    await tx.run(INSERT.into(HISTORY_HEADER).entries(headerRow));
    if (lineRows.length) {
      await tx.run(INSERT.into(HISTORY_LINE).entries(lineRows));
    }

    // Validate the copied archive before deleting anything from the active
    // tables. Counts, status, run AUDIT_ID, reversal document and the
    // consolidation relationship must all match the source group.
    const [archivedTransactions, archivedHeaders, archivedLines] = await Promise.all([
      tx.run(SELECT.from(HISTORY_TRANSACTION).where({
        COMPANY_CODE: group.header.COMPANY_CODE,
        CONSOL_REF_ID: group.header.CONSOL_REF_ID,
        AUDIT_ID: reversalAuditId,
        STATUS_CODE: Constants.REVERSED_STATUS,
        REVERSAL_DOCUMENT: reversalDocument
      })),
      tx.run(SELECT.from(HISTORY_HEADER).where({
        CONSOL_REF_ID: group.header.CONSOL_REF_ID,
        AUDIT_ID: reversalAuditId,
        STATUS_CODE: Constants.REVERSED_STATUS,
        REVERSAL_DOCUMENT: reversalDocument
      })),
      tx.run(SELECT.from(HISTORY_LINE).where({
        CONSOL_REF_ID: group.header.CONSOL_REF_ID,
        AUDIT_ID: reversalAuditId,
        STATUS_CODE: Constants.REVERSED_STATUS,
        REVERSAL_DOCUMENT: reversalDocument
      }))
    ]);

    if (
      archivedTransactions.length !== transactionRows.length ||
      archivedHeaders.length !== 1 ||
      archivedLines.length !== lineRows.length
    ) {
      throw new Error(
        `REVERSAL_MOVE_FAILED: archive validation mismatch for ${group.header.CONSOL_REF_ID}; ` +
        `expected transaction/header/line=${transactionRows.length}/1/${lineRows.length}, ` +
        `actual=${archivedTransactions.length}/${archivedHeaders.length}/${archivedLines.length}`
      );
    }

    // Delete in dependency-safe order only after archive validation succeeds.
    await tx.run(DELETE.from(ACTIVE_LINE).where({ CONSOL_REF_ID: group.header.CONSOL_REF_ID }));
    await tx.run(DELETE.from(ACTIVE_HEADER).where({ CONSOL_REF_ID: group.header.CONSOL_REF_ID }));
    await tx.run(DELETE.from(ACTIVE_TRANSACTION).where({
      COMPANY_CODE: group.header.COMPANY_CODE,
      CONSOL_REF_ID: group.header.CONSOL_REF_ID
    }));

    const [remainingHeader, remainingLines, remainingTransactions] = await Promise.all([
      tx.run(SELECT.one.from(ACTIVE_HEADER).where({ CONSOL_REF_ID: group.header.CONSOL_REF_ID })),
      tx.run(SELECT.from(ACTIVE_LINE).where({ CONSOL_REF_ID: group.header.CONSOL_REF_ID })),
      tx.run(SELECT.from(ACTIVE_TRANSACTION).where({
        COMPANY_CODE: group.header.COMPANY_CODE,
        CONSOL_REF_ID: group.header.CONSOL_REF_ID
      }))
    ]);
    if (remainingHeader || remainingLines.length || remainingTransactions.length) {
      throw new Error(`REVERSAL_MOVE_FAILED: active rows remain for ${group.header.CONSOL_REF_ID}`);
    }

    return {
      transactionCount: transactionRows.length,
      headerCount: 1,
      lineItemCount: lineRows.length,
      archivedAt: now
    };
  }

  _pick(row, columns) {
    const output = {};
    for (const column of columns) {
      if (row[column] !== undefined) output[column] = row[column];
    }
    return output;
  }
}

module.exports = ReversalRepository;
