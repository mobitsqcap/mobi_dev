'use strict';

// SMTP settings are deliberately read from environment variables.  Keep the
// Gmail app password in .env locally (or platform environment variables in BTP),
// never in source code or MTA configuration.
require('dotenv').config();

const nodemailer = require('nodemailer');

class MailNotificationService {
  constructor(env = process.env) {
    this.env = env;
    this.transporter = null;
  }

  isConfigured() {
    return this.env.MAIL_NOTIFICATIONS_ENABLED !== 'false' && [
      'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'SMTP_TO'
    ].every((key) => Boolean(String(this.env[key] || '').trim()));
  }

  async sendRunSummary({ flow, records = [], failed = false, errorMessage = '' }) {
    if (!records.length && !failed) return { sent: false, reason: 'nothing-processed' };
    if (!this.isConfigured()) {
      console.warn(`[MailNotification] ${flow}: SMTP is not configured; summary email was not sent.`);
      return { sent: false, reason: 'not-configured' };
    }

    const total = records.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const final = records.reduce((sum, row) => sum + Number(row.final || 0), 0);
    const errors = records.reduce((sum, row) => sum + Number(row.errors || 0), 0);
    const hasErrors = failed || errors > 0 || records.some((row) => row.status === 'FAILED');
    const outcome = failed ? 'Run failed' : hasErrors ? 'Completed with errors' : 'Completed successfully';
    const rows = records.map((row) => [
      this._escape(row.fileName || row.scenario || flow),
      Number(row.total || 0),
      Number(row.final || 0),
      Number(row.errors || 0),
      this._escape(row.status || ''),
      this._escape(row.location || '')
    ]);

    const htmlRows = rows.length
      ? rows.map((row) => `<tr>${row.map((cell) => `<td style="border:1px solid #ddd;padding:6px">${cell}</td>`).join('')}</tr>`).join('')
      : '<tr><td colspan="6" style="border:1px solid #ddd;padding:6px">The run failed before a file or record summary was available.</td></tr>';
    const errorBlock = errorMessage
      ? `<p><strong>Run error:</strong> ${this._escape(errorMessage)}</p>`
      : '';

    await this._getTransporter().sendMail({
      from: this.env.SMTP_FROM,
      to: this.env.SMTP_TO,
      subject: `[MOBI] ${flow}: ${outcome}`,
      text: this._text(flow, outcome, total, final, errors, records, errorMessage),
      html: `<p><strong>${this._escape(flow)}</strong>: ${outcome}</p>
        <p>Total: <strong>${total}</strong> &nbsp; Final: <strong>${final}</strong> &nbsp; Error: <strong>${errors}</strong></p>
        ${errorBlock}
        <table style="border-collapse:collapse"><thead><tr><th>File / scenario</th><th>Total</th><th>Final</th><th>Error</th><th>Status</th><th>Location / error path</th></tr></thead><tbody>${htmlRows}</tbody></table>`
    });
    return { sent: true };
  }

  _getTransporter() {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.env.SMTP_HOST,
        port: Number(this.env.SMTP_PORT || 587),
        secure: this.env.SMTP_SECURE === 'true',
        requireTLS: this.env.SMTP_SECURE !== 'true',
        auth: { user: this.env.SMTP_USER, pass: this.env.SMTP_PASSWORD }
      });
    }
    return this.transporter;
  }

  _text(flow, outcome, total, final, errors, records, errorMessage) {
    const lines = [`${flow}: ${outcome}`, `Total: ${total}`, `Final: ${final}`, `Error: ${errors}`, ''];
    if (errorMessage) lines.push(`Run error: ${errorMessage}`, '');
    for (const row of records) {
      lines.push(`${row.fileName || row.scenario || flow} | Total: ${row.total || 0} | Final: ${row.final || 0} | Error: ${row.errors || 0} | ${row.status || ''} | ${row.location || ''}`);
    }
    return lines.join('\n');
  }

  _escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
}

module.exports = MailNotificationService;
