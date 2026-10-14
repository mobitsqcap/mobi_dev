'use strict';

const cds = require('@sap/cds');
const StatusCodeUtil = require('../shared/utils/StatusCodeUtil');
const S4ReversalClient = require('../reversal/services/S4ReversalClient');
const ReversalRepository = require('../reversal/repositories/ReversalRepository');
const ReversalSyncService = require('../reversal/services/ReversalSyncService');
const Constants = require('../reversal/constants/ReversalConstants');
const MailNotificationService = require('../shared/mail/MailNotificationService');

module.exports = cds.service.impl(async function () {
  await StatusCodeUtil.ensureStatusTable();

  const syncService = new ReversalSyncService({
    client: new S4ReversalClient(),
    repository: new ReversalRepository()
  });

  this.on('syncReversedDocuments', async (req) => {
    const actor = req?.user?.id || req?.user?.attr?.user_name || Constants.SYSTEM_USER;
    try {
      const result = await syncService.run({ actor });

      // Mail is sent only after the database transaction has committed. The
      // mail service is best-effort and can never change a successful sync to
      // a failed sync.
      try {
        const mailResult = await new MailNotificationService().sendReversalSummary({ result });
        if (!mailResult.sent) {
          console.warn(`[JournalEntryReversalService] summary mail not sent: ${mailResult.error}`);
        }
      } catch (mailError) {
        console.warn(`[JournalEntryReversalService] summary mail failed: ${mailError.message}`);
      }

      return {
        runId: result.runId,
        fromDate: result.fromDate,
        toDate: result.toDate,
        read: result.read,
        moved: result.moved,
        alreadyReversed: result.alreadyReversed,
        ignoredNonBtp: result.ignoredNonBtp,
        skipped: result.skipped,
        failed: result.failed,
        transactionRows: result.transactionRows,
        headerRows: result.headerRows,
        lineItemRows: result.lineItemRows,
        auditDetailRows: result.auditDetailRows,
        reversedDocuments: result.reversedDocuments,
        message: result.message
      };
    } catch (error) {
      console.error(`[JournalEntryReversalService] sync failed: ${error.message}`);
      try {
        const mailResult = await new MailNotificationService().sendRunFailureMail({
          interfaceName: 'SAP Journal Entry Reversal',
          subject: 'SAP Journal Entry Reversal -- Run Failed',
          error: error.message,
          details: [`Actor: ${actor}`]
        });
        if (!mailResult.sent) {
          console.warn(`[JournalEntryReversalService] failure mail not sent: ${mailResult.error}`);
        }
      } catch (mailError) {
        console.warn(`[JournalEntryReversalService] failure mail failed: ${mailError.message}`);
      }
      req.error(500, error.message);
    }
  });
});
