'use strict';

/**
 * SMTP destination loader.
 *
 * Production: reads SMTP configuration from the SAP BTP Destination Service
 * (destination SMTP_MOBI, Type MAIL, Proxy Type Internet,
 * Authentication BasicAuthentication).
 *
 * Local development: falls back to SMTP_* environment variables when the
 * destination cannot be resolved.
 *
 * Expected SMTP_MOBI properties (BTP cockpit):
 *
 *   Main properties
 *     User                        sappostingnotification@mobi.xyz
 *     Password                    <hidden>
 *
 *   Additional properties
 *     mail.smtp.host              smtp.office365.com
 *     mail.smtp.port              587
 *     mail.smtp.starttls.enable   true
 *     mail.smtp.user              sappostingnotification@mobi.xyz
 *     mail.smtp.password          <mailbox password / app password>
 *     mail.from                   <sender address - same mailbox as the login>
 *     mail.to                     <comma-separated recipients, read fresh on every run>
 *
 * NOTE (Type=MAIL + BasicAuthentication): the "User"/"Password" main
 * properties are not reliably exposed as destination.username /
 * destination.password by every Cloud SDK version on Type=MAIL, so the
 * credentials are mirrored into mail.smtp.user / mail.smtp.password -
 * the same pattern SFTP_MOBI uses with sftpUser / sftpPassword.
 *
 * Office 365 (smtp.office365.com:587) uses STARTTLS -> secure:false,
 * requireTLS:true. Switching provider later (e.g. Gmail) only changes the
 * destination properties, not this code.
 */

const { getDestination } = require('@sap-cloud-sdk/connectivity');

const DESTINATION_NAME = 'SMTP_MOBI';

/** Return the first non-empty value. */
function firstNonBlank(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

/** Strip any scheme and trailing slashes - protects against values entered as URLs. */
function normalizeHost(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^smtps?:\/\//i, '')
    .replace(/\/+$/, '');
}

/** Convert value to a positive number. */
function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Convert common string representations to boolean. */
function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['true', '1', 'yes', 'y'].includes(String(value).trim().toLowerCase());
}

/** Parse comma-separated email addresses. */
function parseRecipients(value) {
  if (!value) return [];
  return String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
}

/** Build the nodemailer-ready config object and validate required fields. */
function buildConfig({ host, port, user, password, from, recipients, starttls, source }) {
  const config = {
    host,
    port,
    user,
    password,
    from,
    recipients,
    secure: port === 465,                  // 465 = implicit TLS
    requireTLS: port !== 465 && starttls,  // 587 = STARTTLS (Office 365)
    source
  };

  const missing = ['host', 'user', 'password'].filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(`SMTP configuration incomplete via ${source}: missing ${missing.join(', ')}`);
  }
  return config;
}

/** Load SMTP configuration from the BTP destination SMTP_MOBI. */
async function fromDestination() {
  const destination = await getDestination({ destinationName: DESTINATION_NAME });
  if (!destination) throw new Error(`Destination ${DESTINATION_NAME} not found`);

  const properties = destination.originalProperties || {};
  const port = toNumber(properties['mail.smtp.port'], 587);

  const config = buildConfig({
    host: normalizeHost(firstNonBlank(properties['mail.smtp.host'], destination.url)),
    port,
    // mail.smtp.user / mail.smtp.password come first because the User /
    // Password main properties are not reliably visible on Type=MAIL.
    user: firstNonBlank(
    
      destination.username,
      properties.User,
      properties['mail.from']
    ),
    password: firstNonBlank(
      properties['mail.smtp.password'],
      destination.password,
      properties.Password
    ),
    from: firstNonBlank(properties['mail.from'], destination.username),
    recipients: parseRecipients(properties['mail.to']),
    starttls: toBoolean(properties['mail.smtp.starttls.enable'], port !== 465),
    source: `BTP destination '${destination.name || DESTINATION_NAME}'`
  });

  // Never log the password.
  console.log(
    `[SmtpDestination] Using ${config.source}: ` +
    `host=${config.host}, port=${config.port}, user=${config.user}, ` +
    `secure=${config.secure}, requireTLS=${config.requireTLS}, recipients=${config.recipients.length}`
  );
  return config;
}

/** Local environment fallback (SMTP_* variables). */
function fromEnvironment() {
  const host = normalizeHost(process.env.SMTP_HOST);
  const user = firstNonBlank(process.env.SMTP_USER);
  const password = firstNonBlank(process.env.SMTP_PASSWORD);
  if (!host || !user || !password) return null;

  const port = toNumber(process.env.SMTP_PORT, 587);
  return {
    host,
    port,
    user,
    password,
    from: firstNonBlank(process.env.SMTP_FROM, process.env.MAIL_FROM, user),
    recipients: parseRecipients(process.env.SMTP_TO || process.env.MAIL_TO),
    secure: toBoolean(process.env.SMTP_SECURE, port === 465),
    requireTLS: toBoolean(process.env.SMTP_STARTTLS, port !== 465),
    source: 'environment variables (local fallback)'
  };
}

/**
 * Resolve SMTP configuration.
 * Priority: 1) BTP destination SMTP_MOBI, 2) SMTP_* environment variables, 3) throw.
 */
async function getSmtpConfig() {
  try {
    return await fromDestination();
  } catch (error) {
    console.warn(`[SmtpDestination] ${error.message}. Falling back to environment variables.`);
  }

  const envConfig = fromEnvironment();
  if (!envConfig) {
    throw new Error(
      `SMTP is not configured. Bind destination '${DESTINATION_NAME}' (Type MAIL) or set ` +
      'SMTP_HOST / SMTP_USER / SMTP_PASSWORD.'
    );
  }
  console.log('[SmtpDestination] Using environment variables (local fallback).');
  return envConfig;
}

/**
 * Get mail recipients.
 * Priority: destination mail.to -> MAIL_TO / SMTP_TO env -> none.
 * The BTP destination is the source of truth; nothing is hardcoded.
 */
function getMailRecipients(smtpConfig = null) {
  if (smtpConfig && Array.isArray(smtpConfig.recipients) && smtpConfig.recipients.length > 0) {
    return smtpConfig.recipients;
  }
  return parseRecipients(process.env.MAIL_TO || process.env.SMTP_TO);
}

/** Landscape label shown as "CI Tenant" / environment in the mail header. */
function getMailEnvironment() {
  return firstNonBlank(
    process.env.CI_ENVIRONMENT,
    process.env.BTP_SPACE_NAME,
    (process.env.NODE_ENV || '').toUpperCase(),
    'DEV'
  );
}

module.exports = { DESTINATION_NAME, getSmtpConfig, getMailRecipients, getMailEnvironment };
