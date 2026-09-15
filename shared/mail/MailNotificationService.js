'use strict';

/**
 * MailNotificationService — sends MOBI processing-summary mails via SMTP.
 *
 * SMTP credentials are read from the BTP Destination `SMTP_MOBI` at runtime
 * (see SmtpDestination.js). All send* methods are best-effort: they NEVER
 * throw — they resolve to a result object so a mail failure can never fail
 * an ingestion or consolidation run.
 *
 * Result shape: { sent: true, messageId, to, source }
 *            or { sent: false, error }
 */

const nodemailer = require('nodemailer');
const { getSmtpConfig, getMailRecipients, getMailEnvironment } = require('./SmtpDestination');
const templates = require('./templates');

function formatTimestamp(date = new Date()) {
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

class MailNotificationService {
  constructor({ recipients, environment } = {}) {
    this._recipients = recipients;
    this._environment = environment;
    this._transporter = null;
    this._smtpConfig = null;
    this._from = '';
    this._source = '';
  }

  get environment() {
    return this._environment || getMailEnvironment();
  }

  get recipients() {
    if (Array.isArray(this._recipients)) return this._recipients.filter(Boolean);
    // Destination mail.to first, then env fallback (no hardcoded default).
    return getMailRecipients(this._smtpConfig);
  }

  async _getTransporter() {
    if (this._transporter) return this._transporter;
    const config = await getSmtpConfig();
    this._smtpConfig = config;
    this._from = config.from;
    this._source = config.source;
    this._transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: config.requireTLS,
      auth: { user: config.user, pass: config.password }
    });
    return this._transporter;
  }

  async _send({ subject, html, attachments = [] }) {
    try {
      const transporter = await this._getTransporter();
      const to = this.recipients;
      if (!to.length) {
        return { sent: false, error: 'No recipients configured (set mail.to on destination SMTP_MOBI or the MAIL_TO env var).' };
      }
      const info = await transporter.sendMail({
        from: this._from,
        to: to.join(', '),
        subject,
        html,
        attachments
      });
      console.log(
        `[MailNotificationService] Mail "${subject}" sent via ${this._source} ` +
        `to ${to.join(', ')} (messageId=${info.messageId}).`
      );
      return { sent: true, messageId: info.messageId, to, source: this._source };
    } catch (error) {
      console.error(`[MailNotificationService] Failed to send mail "${subject}": ${error.message}`);
      return { sent: false, error: error.message };
    }
  }

  /**
   * Category 1: SFTP -> BTP ingestion summary (one mail per run).
   * @param {object} args
   * @param {'Master'|'Transaction'} args.fileType
   * @param {object} args.totals { totalRows, validCount, errorCount }
   * @param {Array} args.files per-file results [{ fileName, totalRows, validCount, errorCount, status }]
   * @param {Array} args.errorFiles [{ folderPath, fileName }]
   * @param {Array} args.attachments nodemailer attachments [{ filename, content }]
   * @param {boolean} args.allowPartial false collapses any failure to ERROR (Transaction all-or-nothing)
   */
  async sendSftpFileSummary({
    fileType = 'Master',
    executionTime,
    totals = {},
    files = [],
    errorFiles = [],
    attachments = [],
    pushNote = '',
    actionNote = '',
    allowPartial = true
  } = {}) {
    const outcome = templates.outcomeForRun(files, totals, allowPartial);
    const { subject, html } = templates.buildSftpSummaryMail({
      fileType,
      environment: this.environment,
      executionTime: executionTime || formatTimestamp(),
      totals,
      files,
      errorFiles,
      outcome,
      attachedCount: (attachments || []).length,
      pushNote,
      actionNote
    });
    return this._send({ subject, html, attachments });
  }

  /**
   * Category 2: BTP consolidation summary (one mail per run).
   * @param {object} args
   * @param {string} args.displayName 'Payins' | 'Payout' | 'Domestic Settlement'
   * @param {object} args.stats consolidation counters
   * @param {object|null} args.errorFile { folderPath, fileName }
   */
  async sendConsolidationSummary({
    scenarioCode = '',
    displayName = 'Payins',
    executionTime,
    stats = {},
    errorFile = null,
    attachments = [],
    dryRun = false,
    companyCode = null,
    postingDate = null,
    consolRefIds = '',
    message = ''
  } = {}) {
    const skipped = Number(stats.skippedTransactions || 0);
    const updated = Number(stats.transactionsUpdated || 0);
    // All-or-nothing: PARTIAL = some transactions ready but held back while others are blocked.
    const outcome = skipped === 0 ? 'SUCCESS' : (updated > 0 ? 'PARTIAL' : 'ERROR');
    const { subject, html } = templates.buildConsolidationMail({
      displayName,
      scenarioCode,
      environment: this.environment,
      executionTime: executionTime || formatTimestamp(),
      stats,
      errorFile,
      outcome,
      attachedCount: (attachments || []).length,
      dryRun,
      companyCode,
      postingDate,
      consolRefIds,
      message
    });
    return this._send({ subject, html, attachments });
  }

  /** Red "run failed" mail for unexpected exceptions (no processing summary available). */
  async sendRunFailureMail({
    interfaceName = 'MOBI Integration',
    subject = '',
    executionTime,
    error = '',
    details = []
  } = {}) {
    const built = templates.buildRunFailureMail({
      interfaceName,
      subject,
      environment: this.environment,
      executionTime: executionTime || formatTimestamp(),
      error,
      details
    });
    return this._send({ subject: built.subject, html: built.html, attachments: [] });
  }
}

module.exports = MailNotificationService;
module.exports.formatTimestamp = formatTimestamp;
