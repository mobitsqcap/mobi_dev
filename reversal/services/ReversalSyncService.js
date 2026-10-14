'use strict';

const cds = require('@sap/cds');
const { INSERT, UPDATE } = cds.ql;
const { v4: uuid } = require('uuid');

const Constants = require('../constants/ReversalConstants');
const { lastCompletedCalendarWeek } = require('../utils/LastWeek');
const { normalizeDocument } = require('../utils/DocumentUtil');

const AUDIT = 'mobi.db.MOBI_DB_AUDIT';

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function message(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').slice(0, 500);
}

class ReversalSyncService {
  constructor({ client, repository, timeZone = Constants.TIME_ZONE } = {}) {
    this.client = client;
    this.repository = repository;
    this.timeZone = timeZone;
  }

  async run({ actor = Constants.SYSTEM_USER, now = new Date() } = {}) {
    const range = lastCompletedCalendarWeek({ now, timeZone: this.timeZone });
    const sapRows = await this.client.getReversals(range);
    const runId = uuid();
    const summary = {
      runId,
      fromDate: range.fromDate,
      toDate: range.toDate,
      read: sapRows.length,
      moved: 0,
      alreadyReversed: 0,
      skipped: 0,
      ignoredNonBtp: 0,
      failed: 0,
      transactionRows: 0,
      headerRows: 0,
      lineItemRows: 0,
      auditDetailRows: 0,
      reversedDocuments: []
    };

    const db = await cds.connect.to('db');
    try {
      await db.tx(async (tx) => {
        let line = 1;
        await this._audit(tx, runId, line++, 'I',
          `SAP reversal sync started. range=${range.fromDate}..${range.toDate}, read=${sapRows.length}`, actor);

        for (const sapRow of sapRows) {
          const result = await this._processOne(tx, sapRow, runId);
          if (result.type === 'MOVED') {
            summary.moved += 1;
            summary.transactionRows += result.transactionCount;
            summary.headerRows += result.headerCount;
            summary.lineItemRows += result.lineItemCount;
            summary.reversedDocuments.push({
              companyCode: result.companyCode,
              consolidationRefId: result.consolidationRefId,
              originalDocument: result.originalDocument,
              reversalDocument: result.reversalDocument,
              transactionRows: result.transactionCount,
              lineItemRows: result.lineItemCount
            });
          } else if (result.type === 'ALREADY_REVERSED') {
            summary.alreadyReversed += 1;
          } else if (result.type === 'IGNORED_NON_BTP') {
            summary.ignoredNonBtp += 1;
          } else if (result.type === 'FAILED') {
            summary.failed += 1;
          } else {
            summary.skipped += 1;
          }

          const auditMessageType = result.type === 'MOVED' || result.type === 'ALREADY_REVERSED'
            ? 'S'
            : result.type === 'FAILED' ? 'E' : 'I';

          await this._audit(
            tx,
            runId,
            line++,
            auditMessageType,
            result.auditMessage,
            actor
          );

          if (result.type === 'MOVED' && result.btpDetails?.length) {
            const insertedDetails = await this._auditMany(
              tx,
              runId,
              line,
              result.btpDetails,
              actor
            );
            line += insertedDetails;
            summary.auditDetailRows += insertedDetails;
          }
        }

        const finalType = summary.failed ? 'E' : 'S';
        const finalMessage =
          `SAP reversal sync completed. range=${range.fromDate}..${range.toDate}, ` +
          `read=${summary.read}, moved=${summary.moved}, alreadyReversed=${summary.alreadyReversed}, ` +
          `ignoredNonBtp=${summary.ignoredNonBtp}, skipped=${summary.skipped}, failed=${summary.failed}, ` +
          `snapshots=transaction:${summary.transactionRows},header:${summary.headerRows},line:${summary.lineItemRows}, ` +
          `BTP_TO_BTP_audit_rows=${summary.auditDetailRows}`;

        await tx.run(UPDATE(AUDIT).set({
          MESSAGE_TYPE: finalType,
          STATUS_MESSAGE: message(finalMessage)
        }).where({ AUDIT_ID: runId, AUDIT_LINE_ITEM: 1 }));
      });
    } catch (error) {
      // The movement transaction is deliberately rolled back on technical
      // failures. Write a separate audit row after rollback so operations can
      // see the failure and the next scheduled run can retry safely.
      summary.failed += 1;
      await this._writeFailureAudit({
        runId,
        actor,
        range,
        summary,
        error
      });
      throw error;
    }

    return {
      ...summary,
      message:
        `Processed ${summary.read} SAP reversal(s) for ${range.fromDate} to ${range.toDate}; ` +
        `${summary.moved} moved to reversal history, ${summary.alreadyReversed} already handled, ` +
        `${summary.ignoredNonBtp} direct-SAP/non-BTP reversal(s) skipped without BTP changes, ` +
        `${summary.skipped} validation skip(s), ${summary.failed} failed.`
    };
  }

  async _processOne(tx, sapRow, reversalAuditId) {
    const companyCode = text(sapRow.CompanyCode);
    const originalDocument = text(sapRow.ReverseDocument);
    const reversalDocument = text(sapRow.AccountingDocument);

    if (!companyCode || !originalDocument || !reversalDocument) {
      return {
        type: 'IGNORED_NON_BTP',
        auditMessage: `SKIPPED_NON_BTP_REVERSAL: incomplete BTP reference match; ` +
          `company=${companyCode || '(blank)'}, original=${originalDocument || '(blank)'}, ` +
          `reversal=${reversalDocument || '(blank)'}`
      };
    }

    // Lock the active header lookup before reading history. If two scheduler
    // executions overlap, the second one waits for the first movement and then
    // sees the committed archive state instead of creating a duplicate copy.
    const activeHeaders = await this.repository.findActiveHeaders(tx, companyCode, originalDocument);
    const historyHeaders = await this.repository.findHistoryHeaders(tx, companyCode, originalDocument);

    if (activeHeaders.length > 1) {
      return {
        type: 'SKIPPED',
        auditMessage: `MULTIPLE_MATCHES: company=${companyCode}, original=${originalDocument}, ` +
          `activeHeaders=${activeHeaders.length}`
      };
    }

    if (!activeHeaders.length) {
      const historyMatch = historyHeaders.find((row) =>
        normalizeDocument(row.REVERSAL_DOCUMENT) === normalizeDocument(reversalDocument)
      );
      if (historyMatch) {
        return {
          type: 'ALREADY_REVERSED',
          auditMessage: `ALREADY_REVERSED: company=${companyCode}, original=${originalDocument}, ` +
            `reversal=${reversalDocument}, CONSOL_REF_ID=${historyMatch.CONSOL_REF_ID}`
        };
      }
      if (historyHeaders.length) {
        return {
          type: 'SKIPPED',
          auditMessage: `INCONSISTENT_REVERSAL_STATE: company=${companyCode}, original=${originalDocument}, ` +
            `historyRows=${historyHeaders.length}, reversal=${reversalDocument}`
        };
      }
      return {
        type: 'IGNORED_NON_BTP',
        auditMessage: `SKIPPED_NON_BTP_REVERSAL: company=${companyCode}, original=${originalDocument}, ` +
          'no active BTP header has a matching SAP_REF_DOCUMENT; SAP reversal remains successful.'
      };
    }

    if (historyHeaders.length) {
      return {
        type: 'SKIPPED',
        auditMessage: `INCONSISTENT_REVERSAL_STATE: active and history rows both exist for ` +
          `company=${companyCode}, original=${originalDocument}`
      };
    }

    const header = activeHeaders[0];
    if (text(header.STATUS_CODE) !== Constants.POSTED_STATUS) {
      return {
        type: 'SKIPPED',
        auditMessage: `INVALID_REVERSAL_STATE: company=${companyCode}, original=${originalDocument}, ` +
          `CONSOL_REF_ID=${header.CONSOL_REF_ID}, headerStatus=${text(header.STATUS_CODE) || '(blank)'}, ` +
          `expected=${Constants.POSTED_STATUS}`
      };
    }

    const group = await this.repository.loadActiveGroup(tx, header);
    const incomplete = group.transactions.length === 0 || group.lines.length === 0;
    const nonPostedLine = group.lines.some((row) => text(row.STATUS_CODE) !== Constants.POSTED_STATUS);
    const nonPostedTransaction = group.transactions.some((row) => status(row.STATUS_CODE) !== Constants.POSTED_STATUS);
    if (incomplete || nonPostedLine || nonPostedTransaction) {
      return {
        type: 'SKIPPED',
        auditMessage: `INCOMPLETE_CONSOLIDATION: company=${companyCode}, original=${originalDocument}, ` +
          `CONSOL_REF_ID=${header.CONSOL_REF_ID}, transactions=${group.transactions.length}, ` +
          `lines=${group.lines.length}, headerStatus=${text(header.STATUS_CODE)}, ` +
          `allPosted=${!nonPostedLine && !nonPostedTransaction}`
      };
    }

    const moved = await this.repository.archiveAndDelete(tx, group, sapRow, reversalAuditId);
    return {
      type: 'MOVED',
      ...moved,
      companyCode,
      consolidationRefId: header.CONSOL_REF_ID,
      originalDocument,
      reversalDocument,
      btpDetails: this._buildBtpDetails({
        group,
        companyCode,
        originalDocument,
        reversalDocument,
        reversalAuditId
      }),
      auditMessage: `MOVED: company=${companyCode}, original=${originalDocument}, ` +
        `reversal=${reversalDocument}, CONSOL_REF_ID=${header.CONSOL_REF_ID}, ` +
        `transactions=${moved.transactionCount}, headers=${moved.headerCount}, lines=${moved.lineItemCount}`
    };
  }

  _buildBtpDetails({
    group,
    companyCode,
    originalDocument,
    reversalDocument,
    reversalAuditId
  }) {
    const common = [
      `company=${companyCode}`,
      `CONSOL_REF_ID=${text(group.header.CONSOL_REF_ID)}`,
      `AUDIT_ID=${reversalAuditId}`,
      `REVERSAL_DOCUMENT=${reversalDocument}`,
      'STATUS_CODE=066'
    ];

    const transactionDetails = group.transactions.map((row) => ({
      entity: 'TRANSACTION',
      statusMessage: [
        'TRANSACTION',
        ...common,
        `MOBI_REFERENCE_ID=${text(row.MOBI_REFERENCE_ID)}`,
        `PAYMENT_TYPE=${text(row.PAYMENT_TYPE)}`
      ].join(', ')
    }));

    const headerDetail = {
      entity: 'HEADER',
      statusMessage: [
        'HEADER',
        ...common,
        `ORIGINAL_SAP_DOCUMENT=${originalDocument}`
      ].join(', ')
    };

    const lineDetails = group.lines.map((row) => ({
      entity: 'LINE_ITEM',
      statusMessage: [
        'LINE_ITEM',
        ...common,
        `DOC_REF_ITEM=${row.DOC_REF_ITEM ?? ''}`,
        `SAP_REF_DOCUMENT=${text(row.SAP_REF_DOCUMENT)}`,
        `PAYMENT_TYPE=${text(row.PAYMENT_TYPE)}`
      ].join(', ')
    }));

    // Keep the audit in parent-to-child order: header, line items, then
    // transactions. This makes a run easy to inspect in AUDIT_LINE_ITEM order.
    return [headerDetail, ...lineDetails, ...transactionDetails];
  }

  async _auditMany(tx, auditId, startLineItem, details, actor) {
    if (!details?.length) return 0;

    const now = new Date().toISOString();
    const entries = details.map((detail, index) => ({
      AUDIT_ID: auditId,
      AUDIT_LINE_ITEM: startLineItem + index,
      PROCESS_NAME: 'SAP_REVERSAL',
      PROCESS_TYPE: 'BTP_TO_BTP',
      MESSAGE_TYPE: 'S',
      STATUS_MESSAGE: message(detail.statusMessage),
      CREATED_BY: actor,
      CREATED_TIMESTAMP: now
    }));

    // Keep each database INSERT below a safe batch size while preserving the
    // same transaction and consecutive AUDIT_LINE_ITEM values.
    const chunkSize = 500;
    for (let index = 0; index < entries.length; index += chunkSize) {
      await tx.run(INSERT.into(AUDIT).entries(entries.slice(index, index + chunkSize)));
    }
    return entries.length;
  }

  async _audit(tx, auditId, lineItem, messageType, statusMessage, actor) {
    await tx.run(INSERT.into(AUDIT).entries({
      AUDIT_ID: auditId,
      AUDIT_LINE_ITEM: lineItem,
      PROCESS_NAME: 'SAP_REVERSAL',
      PROCESS_TYPE: 'S4_TO_BTP',
      MESSAGE_TYPE: messageType,
      STATUS_MESSAGE: message(statusMessage),
      CREATED_BY: actor,
      CREATED_TIMESTAMP: new Date().toISOString()
    }));
  }

  async _writeFailureAudit({ runId, actor, range, summary, error }) {
    try {
      const db = await cds.connect.to('db');
      await db.run(INSERT.into(AUDIT).entries({
        AUDIT_ID: runId,
        AUDIT_LINE_ITEM: 1,
        PROCESS_NAME: 'SAP_REVERSAL',
        PROCESS_TYPE: 'S4_TO_BTP',
        MESSAGE_TYPE: 'E',
        STATUS_MESSAGE: message(
          `REVERSAL_MOVE_FAILED: range=${range.fromDate}..${range.toDate}, ` +
          `read=${summary.read}, movedBeforeRollback=${summary.moved}, ` +
          `error=${error.message}`
        ),
        CREATED_BY: actor,
        CREATED_TIMESTAMP: new Date().toISOString()
      }));
    } catch (auditError) {
      console.error(`[ReversalSyncService] Could not write failure audit: ${auditError.message}`);
    }
  }
}

function status(value) {
  return text(value).padStart(3, '0');
}

module.exports = ReversalSyncService;
