'use strict';

const cds = require('@sap/cds');
const path = require('path');
const { v4: uuid } = require('uuid');

const ScenarioConfig = require('../config/ScenarioConfig');
const ConsolidationService = require('../services/ConsolidationService');
const ConsolidationRepository = require('../repositories/ConsolidationRepository');
const MasterRepository = require('../repositories/MasterRepository');
const GLAccountRepository = require('../repositories/GLAccountRepository');
const TransactionRepository = require('../repositories/TransactionRepository');
const AuditRepository = require('../repositories/AuditRepository');
const ReferenceNumberService = require('../services/ReferenceNumberService');
const ConsolidationSftpService = require('../services/ConsolidationSftpService');
const Constants = require('../constants/ConsolidationConstants');
const MailNotificationService = require('../../shared/mail/MailNotificationService');

// Minimal infra shim — replace with your project's real infra if present.
let infra;
try { infra = require('../../infra'); } catch (_) { infra = null; }

const log = infra?.Logger ? new infra.Logger('ConsolScenario') : console;
const serviceCache = new Map();

function getConsolidationService(scenarioCode) {
  if (serviceCache.has(scenarioCode)) return serviceCache.get(scenarioCode);

  const consolidationRepository = new ConsolidationRepository();
  const svc = new ConsolidationService({
    masterRepository: new MasterRepository(),
    transactionRepository: new TransactionRepository(),
    consolidationRepository,
    glAccountRepository: new GLAccountRepository(),
    auditRepository: new AuditRepository({ softFail: false }),
    referenceNumberService: new ReferenceNumberService(consolidationRepository)
  });
  serviceCache.set(scenarioCode, svc);
  return svc;
}

async function withDbRetry(fn, { label, log: logger } = {}) {
  if (infra?.withDbRetry) return infra.withDbRetry(fn, { label, log: logger });
  return fn();
}

// Display names used in mail subjects, e.g. "Payins -- Consolidated Successfully".
const MAIL_DISPLAY_NAMES = {
  PAYIN: 'Payins',
  PAYOUT: 'Payout',
  DOMESTIC_SETTLEMENT: 'Domestic Settlement'
};

/**
 * Sends the one-mail-per-run consolidation summary. Best-effort: resolves to
 * a result object and never throws, so mail can never fail the run.
 */
async function sendConsolidationMail({ scenarioCode, scenario, params, result }) {
  const mailService = new MailNotificationService();
  const attachments = [];
  const errorFileName = (result && result.consolidationErrorFile) || '';
  if (errorFileName) {
    const sftpService = new ConsolidationSftpService();
    try {
      const remotePath = path.posix.join(Constants.SFTP.CONSOL_ERROR_PATH, errorFileName);
      const content = await sftpService.downloadFile(remotePath);
      if (content && content.length) {
        attachments.push({ filename: errorFileName, content: Buffer.from(content) });
      }
    } catch (attachmentError) {
      console.warn(
        `[ConsolScenario] Could not attach ${errorFileName} to notification mail: ${attachmentError.message}`
      );
    } finally {
      try { await sftpService.disconnect(); } catch (_) { /* ignore */ }
    }
  }
  return mailService.sendConsolidationSummary({
    scenarioCode,
    displayName: MAIL_DISPLAY_NAMES[scenarioCode] || (scenario && scenario.displayName) || scenarioCode,
    stats: {
      inputTransactions: result.inputTransactions,
      skippedTransactions: result.skippedTransactions,
      glAccountMissing: result.glAccountMissing,
      bpMasterMissing: result.bpMasterMissing,
      errorRecordsUpdated: result.errorRecordsUpdated,
      headersCreated: result.headersCreated,
      lineItemsCreated: result.lineItemsCreated,
      transactionsUpdated: result.transactionsUpdated
    },
    errorFile: errorFileName
      ? { folderPath: Constants.SFTP.CONSOL_ERROR_PATH, fileName: errorFileName }
      : null,
    attachments,
    dryRun: Boolean(result.dryRun),
    companyCode: params.companyCode,
    postingDate: params.postingDate,
    consolRefIds: result.consolRefIds || '',
    message: result.message || ''
  });
}

function logMailResult(logger, mailResult) {
  const line = mailResult && mailResult.sent
    ? `Notification mail sent to ${(mailResult.to || []).join(', ')} (messageId=${mailResult.messageId}, via ${mailResult.source}).`
    : `Notification mail failed: ${((mailResult && mailResult.error) || 'unknown error')}.`;
  if (logger && logger.info) logger.info(line);
  else console.log(`[ConsolScenario] ${line}`);
}

module.exports = function createScenarioHandler(scenarioCode) {
  const scenario = ScenarioConfig[scenarioCode];
  if (!scenario) throw new Error(`Unknown consolidation scenario: ${scenarioCode}`);

  const consolidationService = getConsolidationService(scenarioCode);

  return async function scenarioHandler(req) {
    const actor = req?.user?.id || req?.user?.attr?.user_name || scenario.systemUser;
    const {
      companyCode = null,
      postingDate = null,
      documentDate = null,
      baselineDate = null,
      dryRun = false
    } = req.data || {};

    const correlationId = req?.headers?.['x-correlation-id'] || uuid();

    const processor = () => withDbRetry(
      () => consolidationService.run(scenarioCode, {
        companyCode,
        postingDate,
        documentDate,
        baselineDate,
        dryRun: dryRun === true || dryRun === 'true',
        requestedBy: actor
      }),
      { label: `consol:${scenarioCode}`, log }
    );

    try {
      const result = await processor();

      // Best-effort mail notification — one summary mail per run, never fails the run.
      try {
        const mailResult = await sendConsolidationMail({
          scenarioCode,
          scenario,
          params: { companyCode, postingDate },
          result
        });
        logMailResult(log, mailResult);
      } catch (mailError) {
        logMailResult(log, { sent: false, error: mailError.message });
      }

      return {
        scenario: result.scenario,
        dryRun: Boolean(result.dryRun),
        inputTransactions: Number(result.inputTransactions || 0),
        skippedTransactions: Number(result.skippedTransactions || 0),
        glAccountMissing: Number(result.glAccountMissing || 0),
        bpMasterMissing: Number(result.bpMasterMissing || 0),
        errorRecordsUpdated: Number(result.errorRecordsUpdated || 0),
        headersCreated: Number(result.headersCreated || 0),
        lineItemsCreated: Number(result.lineItemsCreated || 0),
        transactionsUpdated: Number(result.transactionsUpdated || 0),
        consolRefIds: result.consolRefIds || '',
        consolidationErrorFile: result.consolidationErrorFile || '',
        message: result.message || ''
      };
    } catch (err) {
      if (log.error) log.error(`${scenarioCode} run failed: ${err.message}`, { correlationId });
      else console.error(`[${scenarioCode}] run failed: ${err.message}`);
      // Best-effort failure mail so the team is informed even on unexpected errors.
      try {
        const displayName = MAIL_DISPLAY_NAMES[scenarioCode] || scenario.displayName || scenarioCode;
        const mailService = new MailNotificationService();
        const mailResult = await mailService.sendRunFailureMail({
          interfaceName: `${displayName} Consolidation`,
          subject: `${displayName} -- Consolidation Failure`,
          error: err.message,
          details: [`Correlation ID: ${correlationId}`]
        });
        logMailResult(log, mailResult);
      } catch (mailError) {
        logMailResult(log, { sent: false, error: mailError.message });
      }
      req.error(500, err.message);
    }
  };
};
