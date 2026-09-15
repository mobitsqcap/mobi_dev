'use strict';

/**
 * One-mail-per-run helper for Master / Transaction ingestion.
 * Aggregates the per-file results returned by the UnifiedIngestionHandlers,
 * downloads error detail files for attachment and sends the summary mail.
 * Always best-effort: never throws, returns log lines for the action response.
 */

const path = require('path');
const MailNotificationService = require('./MailNotificationService');
const { downloadErrorAttachments } = require('./sftpAttachments');

const FLOW_NOTES = {
  Master: {
    pushNote: 'Valid records have been pushed to BTP.',
    actionNote: 'Please review the attached error file(s) and the error file(s) in the SFTP ERROR folder. ' +
      'Correct the failed records and place a corrected file for reprocessing. ' +
      'Valid records from partially processed files have already been pushed to BTP.'
  },
  Transaction: {
    pushNote: 'Failed files were NOT pushed to BTP (all-or-nothing per file).',
    actionNote: 'Please review the attached error file(s) and the error file(s) in the SFTP ERROR folder. ' +
      'Failed files were not pushed to BTP (all-or-nothing per file): correct the failed records and resend ' +
      'them as Transactions_YYYYMMDD_Updated.csv so the run can be retried.'
  }
};

function sumTotals(fileResults = []) {
  return (fileResults || []).reduce(
    (acc, file) => ({
      totalRows: acc.totalRows + Number(file.totalRows || 0),
      validCount: acc.validCount + Number(file.validCount || 0),
      errorCount: acc.errorCount + Number(file.errorCount || 0)
    }),
    { totalRows: 0, validCount: 0, errorCount: 0 }
  );
}

function toErrorFileEntries(fileResults = []) {
  const entries = [];
  for (const file of fileResults || []) {
    if (!file || file.status === 'COMPLETED') continue;
    const remotePath = file.errorTextPath || file.errorPath;
    if (!remotePath) continue;
    entries.push({
      folderPath: path.posix.dirname(remotePath),
      fileName: path.posix.basename(remotePath)
    });
  }
  return entries;
}

async function sendIngestionSummaryMail({ flow = 'Master', sftpService, result } = {}) {
  const logs = [];
  try {
    const fileResults = (result && result.fileResults) || [];
    if (!fileResults.length) {
      logs.push('Mail notification skipped: no files were processed in this run.');
      return logs;
    }
    const totals = (result && result.totals) || sumTotals(fileResults);
    const errorFiles = toErrorFileEntries(fileResults);
    const attachments = sftpService
      ? await downloadErrorAttachments(sftpService, fileResults, logs)
      : [];
    const notes = FLOW_NOTES[flow] || FLOW_NOTES.Master;
    const mailService = new MailNotificationService();
    const mailResult = await mailService.sendSftpFileSummary({
      fileType: flow,
      // Transaction is all-or-nothing: any failure is a red ERROR mail, never yellow.
      allowPartial: flow !== 'Transaction',
      totals,
      files: fileResults,
      errorFiles,
      attachments,
      pushNote: notes.pushNote,
      actionNote: notes.actionNote
    });
    if (mailResult.sent) {
      logs.push(
        `Mail notification sent to ${mailResult.to.join(', ')} ` +
        `(messageId=${mailResult.messageId}, via ${mailResult.source}).`
      );
    } else {
      logs.push(`Mail notification failed: ${mailResult.error || 'unknown error'}.`);
    }
  } catch (error) {
    logs.push(`Mail notification failed: ${error.message}`);
  }
  return logs;
}

async function sendIngestionFailureMail({ flow = 'Master', error } = {}) {
  const logs = [];
  try {
    const interfaceName = `${flow} SFTP to BTP Integration`;
    const mailService = new MailNotificationService();
    const mailResult = await mailService.sendRunFailureMail({
      interfaceName,
      subject: `${flow}---SFTP to BTP Integration Error`,
      error: (error && error.message) || String(error)
    });
    if (mailResult.sent) {
      logs.push(
        `Failure notification mail sent to ${mailResult.to.join(', ')} ` +
        `(messageId=${mailResult.messageId}, via ${mailResult.source}).`
      );
    } else {
      logs.push(`Failure notification mail could not be sent: ${mailResult.error || 'unknown error'}.`);
    }
  } catch (mailError) {
    logs.push(`Failure notification mail could not be sent: ${mailError.message}`);
  }
  return logs;
}

module.exports = { sendIngestionSummaryMail, sendIngestionFailureMail, sumTotals, toErrorFileEntries };
