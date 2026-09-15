'use strict';

/**
 * Pure HTML builders for MOBI mail notifications (no dependencies, no I/O).
 *
 * All mails follow the approved "SAP Cloud Integration" reference structure:
 * colour-coded banner, processing summary, error file details, recommended
 * action and the MOBI Integration Platform footer.
 *
 * Outcomes:
 *   SUCCESS (green) — every file/record processed without errors
 *   PARTIAL (yellow) — some records succeeded, some failed
 *   ERROR   (red)    — nothing could be processed successfully
 */

const OUTCOME_META = {
  SUCCESS: { label: 'SUCCESS', banner: '#28a745', title: '#1e7e34' },
  PARTIAL: { label: 'PARTIALLY PROCESSED', banner: '#e0a800', title: '#9a6b00' },
  ERROR: { label: 'ERROR', banner: '#dc3545', title: '#dc3545' }
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function num(value) {
  return Number(value || 0);
}

/**
 * Run-level outcome from per-file results plus aggregated record totals.
 * File statuses: COMPLETED | PARTIAL | FAILED
 * allowPartial=false (Transaction: all-or-nothing) collapses any failure to ERROR.
 */
function outcomeForRun(files = [], totals = {}, allowPartial = true) {
  const list = files || [];
  if (!list.length) return 'SUCCESS';
  const hasFailure = list.some((file) => file.status !== 'COMPLETED');
  if (!hasFailure) return 'SUCCESS';
  if (!allowPartial) return 'ERROR';
  const hasSuccess = list.some((file) => file.status === 'COMPLETED' || file.status === 'PARTIAL')
    || num(totals.validCount) > 0;
  return hasSuccess ? 'PARTIAL' : 'ERROR';
}

function statusChip(status) {
  const meta = status === 'COMPLETED'
    ? { bg: '#28a745', label: 'COMPLETED' }
    : status === 'PARTIAL'
      ? { bg: '#e0a800', label: 'PARTIAL' }
      : { bg: '#dc3545', label: 'FAILED' };
  return `<span style="display:inline-block;background:${meta.bg};color:#ffffff;` +
    `font-size:12px;font-weight:bold;padding:3px 10px;border-radius:10px;">${meta.label}</span>`;
}

function shell({ banner, environment, titleHtml, greetingHtml, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>MOBI Integration Notification</title>
</head>
<body style="margin:0;padding:20px;background:#f2f4f7;font-family:Arial,Helvetica,sans-serif;">
<table align="center" width="700" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #d9d9d9;border-radius:8px;">
<tr>
<td align="center" style="background:${banner};color:#ffffff;padding:30px;border-radius:8px 8px 0 0;">
<div style="font-size:32px;font-weight:bold;">SAP Cloud Integration</div>
<div style="font-size:18px;margin-top:8px;">${escapeHtml(environment)}</div>
</td>
</tr>
<tr>
<td style="padding:30px 40px 10px 40px;">
${titleHtml}
<p style="font-size:15px;color:#444444;line-height:24px;">Hello Team,<br><br>${greetingHtml}</p>
</td>
</tr>
${bodyHtml}
<tr>
<td align="center" style="background:#555555;color:#ffffff;padding:20px;border-radius:0 0 8px 8px;">
<b>MOBI Integration Platform</b><br>
This is an automatically generated email from SAP Cloud Integration.<br>
Please do not reply.
</td>
</tr>
</table>
</body>
</html>`;
}

function summaryBox(rowsHtml) {
  return `<tr>
<td style="padding:0 40px;">
<div style="background:#eef7ff;border-left:6px solid #009de0;padding:20px;">
<h3 style="margin-top:0;color:#009de0;">Processing Summary</h3>
<table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;">
${rowsHtml}
</table>
</div>
</td>
</tr>`;
}

function summaryRow(label, valueHtml) {
  return `<tr><td width="40%"><b>${escapeHtml(label)}</b></td><td>${valueHtml}</td></tr>`;
}

function errorFilesBox(errorFiles, attachedCount) {
  const rows = errorFiles.map((entry, index) => (
    `<tr><td width="6%" style="border-top:1px solid #e0c36a;">${index + 1}</td>` +
    `<td width="47%" style="border-top:1px solid #e0c36a;"><b>SFTP Folder Path</b><br>${escapeHtml(entry.folderPath)}</td>` +
    `<td width="47%" style="border-top:1px solid #e0c36a;"><b>Error File Name</b><br>${escapeHtml(entry.fileName)}</td></tr>`
  )).join('');
  const attachNote = attachedCount > 0
    ? `<p style="margin:12px 0 0 0;font-size:14px;color:#444444;">The error detail file(s) are also attached to this email for quick reference.</p>`
    : '';
  return `<tr>
<td style="padding:25px 40px 0 40px;">
<div style="background:#fff8e5;border-left:6px solid #f39c12;padding:20px;">
<h3 style="margin-top:0;color:#d35400;">Error File Details</h3>
<table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;">
${rows}
</table>
${attachNote}
</div>
</td>
</tr>`;
}

function actionBox(text) {
  return `<tr>
<td style="padding:25px 40px 30px 40px;">
<div style="background:#fdeeee;border-left:6px solid #dc3545;padding:20px;">
<h3 style="margin-top:0;color:#dc3545;">Recommended Action</h3>
<p style="margin:0;font-size:15px;line-height:24px;color:#444444;">${text}</p>
</div>
</td>
</tr>`;
}

function bottomSpacer() {
  return '<tr><td style="padding:0 40px 30px 40px;"></td></tr>';
}

// ---------------------------------------------------------------------------
// Category 1: SFTP -> BTP ingestion (Master / Transaction)
// ---------------------------------------------------------------------------

function sftpSubject(fileType, outcome) {
  const suffix = outcome === 'SUCCESS' ? 'Success' : outcome === 'PARTIAL' ? 'Partially Processed' : 'Error';
  return `${fileType}---SFTP to BTP Integration ${suffix}`;
}

function buildSftpSummaryMail({
  fileType = 'Master',
  environment = 'DEV',
  executionTime = '',
  totals = {},
  files = [],
  errorFiles = [],
  outcome = 'SUCCESS',
  attachedCount = 0,
  pushNote = '',
  actionNote = ''
}) {
  const meta = OUTCOME_META[outcome] || OUTCOME_META.SUCCESS;
  const interfaceName = `${fileType} SFTP to BTP Integration`;
  const total = num(totals.totalRows);
  const success = num(totals.validCount);
  const failed = num(totals.errorCount);
  const list = files || [];
  const filesOk = list.filter((f) => f.status === 'COMPLETED').length;
  const filesPartial = list.filter((f) => f.status === 'PARTIAL').length;
  const filesFailed = list.filter((f) => f.status !== 'COMPLETED' && f.status !== 'PARTIAL').length;

  const greeting = outcome === 'SUCCESS'
    ? `The <b>${escapeHtml(interfaceName)}</b> interface execution has completed <b>successfully</b>. ` +
      `All <b>${total}</b> record(s) were processed without errors. ${escapeHtml(pushNote)}`
    : outcome === 'PARTIAL'
      ? `The <b>${escapeHtml(interfaceName)}</b> interface execution has completed with <b>partial success</b>. ` +
        `Some records could not be processed successfully. ${escapeHtml(pushNote)} Please find the processing summary below.`
      : `The <b>${escapeHtml(interfaceName)}</b> interface execution has completed with <b>errors</b>. ` +
        `No records could be processed successfully. ${escapeHtml(pushNote)} Please find the processing summary below.`;

  let rows = summaryRow('CI Tenant', escapeHtml(environment))
    + summaryRow('Interface Name', escapeHtml(interfaceName))
    + summaryRow('Execution Time', escapeHtml(executionTime))
    + summaryRow('Files Processed', String(list.length))
    + summaryRow('Files Successful', `<span style="color:green;font-weight:bold;">${filesOk}</span>`);
  if (filesPartial > 0) {
    rows += summaryRow('Files Partially Processed', `<span style="color:#9a6b00;font-weight:bold;">${filesPartial}</span>`);
  }
  rows += summaryRow('Files Failed', `<span style="color:red;font-weight:bold;">${filesFailed}</span>`)
    + summaryRow('Total Records', String(total))
    + summaryRow('Successful Records', `<span style="color:green;font-weight:bold;">${success}</span>`)
    + summaryRow('Failed Records', `<span style="color:red;font-weight:bold;">${failed}</span>`);

  let body = summaryBox(rows);

  if (list.length) {
    const fileRows = list.map((file) => (
      `<tr><td style="border-top:1px solid #cfe3f5;word-break:break-all;">${escapeHtml(file.fileName)}</td>` +
      `<td align="right" style="border-top:1px solid #cfe3f5;">${num(file.totalRows)}</td>` +
      `<td align="right" style="border-top:1px solid #cfe3f5;color:green;font-weight:bold;">${num(file.validCount)}</td>` +
      `<td align="right" style="border-top:1px solid #cfe3f5;color:red;font-weight:bold;">${num(file.errorCount)}</td>` +
      `<td align="center" style="border-top:1px solid #cfe3f5;">${statusChip(file.status)}</td></tr>`
    )).join('');
    body += `<tr>
<td style="padding:25px 40px 0 40px;">
<div style="background:#eef7ff;border-left:6px solid #009de0;padding:20px;">
<h3 style="margin-top:0;color:#009de0;">Per-File Breakdown</h3>
<table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
<tr style="color:#555555;"><td><b>File Name</b></td><td align="right"><b>Total</b></td><td align="right"><b>Success</b></td><td align="right"><b>Failed</b></td><td align="center"><b>Status</b></td></tr>
${fileRows}
</table>
</div>
</td>
</tr>`;
  }

  if (outcome !== 'SUCCESS' && errorFiles.length) {
    body += errorFilesBox(errorFiles, attachedCount);
  }
  body += outcome !== 'SUCCESS' && actionNote ? actionBox(escapeHtml(actionNote)) : bottomSpacer();

  return {
    subject: sftpSubject(fileType, outcome),
    html: shell({
      banner: meta.banner,
      environment,
      titleHtml: `<h2 style="margin:0;color:${meta.title};">${escapeHtml(interfaceName)} — ${meta.label}</h2>`,
      greetingHtml: greeting,
      bodyHtml: body
    })
  };
}

// ---------------------------------------------------------------------------
// Category 2: BTP consolidation (Payins / Payout / Domestic Settlement)
// ---------------------------------------------------------------------------

function consolidationSubject(displayName, outcome, dryRun) {
  const base = outcome === 'SUCCESS'
    ? `${displayName} -- Consolidated Successfully`
    : outcome === 'PARTIAL'
      ? `${displayName} -- Partially Consolidated`
      : `${displayName} -- Consolidation Failure`;
  return dryRun ? `[DRY RUN] ${base}` : base;
}

function buildConsolidationMail({
  displayName = 'Payins',
  scenarioCode = '',
  environment = 'DEV',
  executionTime = '',
  stats = {},
  errorFile = null,
  outcome = 'SUCCESS',
  attachedCount = 0,
  dryRun = false,
  companyCode = null,
  postingDate = null,
  consolRefIds = '',
  message = ''
}) {
  const meta = OUTCOME_META[outcome] || OUTCOME_META.SUCCESS;
  const interfaceName = `${displayName} Consolidation`;
  const total = num(stats.inputTransactions);
  const success = num(stats.transactionsUpdated);
  const failed = num(stats.skippedTransactions);

  const greeting = outcome === 'SUCCESS'
    ? (total === 0
      ? `The <b>${escapeHtml(interfaceName)}</b> interface execution has completed <b>successfully</b>. ` +
        'No pending transactions were found for consolidation in this run.'
      : `The <b>${escapeHtml(interfaceName)}</b> interface execution has completed <b>successfully</b>. ` +
        `All <b>${total}</b> transaction(s) were consolidated without errors and are pending posting to SAP.`)
    : outcome === 'PARTIAL'
      ? `The <b>${escapeHtml(interfaceName)}</b> interface execution has completed with <b>partial success</b>. ` +
        `<b>${success}</b> transaction(s) are ready but were <b>held back, not posted</b> (all-or-nothing: ` +
        `no documents are created while <b>${failed}</b> record(s) are blocked). ` +
        'Please find the processing summary below.'
      : `The <b>${escapeHtml(interfaceName)}</b> interface execution has completed with <b>errors</b>. ` +
        `No transactions could be consolidated (all-or-nothing: no documents were created). ` +
        'Please find the processing summary below.';

  let rows = summaryRow('CI Tenant', escapeHtml(environment))
    + summaryRow('Interface Name', escapeHtml(interfaceName))
    + summaryRow('Scenario', escapeHtml(scenarioCode || displayName))
    + summaryRow('Execution Time', escapeHtml(executionTime))
    + summaryRow('Company Code', escapeHtml(companyCode || 'All'))
    + summaryRow('Posting Date', escapeHtml(postingDate || 'All'))
    + summaryRow('Dry Run', dryRun ? 'Yes' : 'No')
    + summaryRow('Total Records', String(total))
    + summaryRow(outcome === 'PARTIAL' ? 'Ready Records (held, not posted)' : 'Successful Records', `<span style="color:green;font-weight:bold;">${success}</span>`)
    + summaryRow('Failed Records', `<span style="color:red;font-weight:bold;">${failed}</span>`)
    + summaryRow('GL Accounts Missing', String(num(stats.glAccountMissing)))
    + summaryRow('BP Master Missing', String(num(stats.bpMasterMissing)))
    + summaryRow('Headers Created', String(num(stats.headersCreated)))
    + summaryRow('Line Items Created', String(num(stats.lineItemsCreated)));
  if (consolRefIds) {
    rows += summaryRow('Consol Ref IDs', `<span style="word-break:break-all;">${escapeHtml(consolRefIds)}</span>`);
  }
  if (message) {
    rows += summaryRow('Result', escapeHtml(message));
  }

  let body = summaryBox(rows);

  if (outcome !== 'SUCCESS' && errorFile) {
    body += errorFilesBox([errorFile], attachedCount);
    body += actionBox(
      'Please review the attached consolidation error file and the error file in the SFTP ERROR folder. ' +
      'Fix the missing GL account / business-partner master data and re-run consolidation. ' +
      'Blocked records were not posted (all-or-nothing) and will be picked up automatically on the next run.'
    );
  } else {
    body += bottomSpacer();
  }

  return {
    subject: consolidationSubject(displayName, outcome, dryRun),
    html: shell({
      banner: meta.banner,
      environment,
      titleHtml: `<h2 style="margin:0;color:${meta.title};">${escapeHtml(interfaceName)} — ${meta.label}</h2>`,
      greetingHtml: greeting,
      bodyHtml: body
    })
  };
}

// ---------------------------------------------------------------------------
// Run failure (unexpected exception before/without a processing summary)
// ---------------------------------------------------------------------------

function buildRunFailureMail({
  interfaceName = 'MOBI Integration',
  subject = '',
  environment = 'DEV',
  executionTime = '',
  error = '',
  details = []
}) {
  const meta = OUTCOME_META.ERROR;
  const greeting = `The <b>${escapeHtml(interfaceName)}</b> interface execution has <b>failed unexpectedly</b> ` +
    'before a processing summary could be produced. Please find the failure details below.';

  let rows = summaryRow('CI Tenant', escapeHtml(environment))
    + summaryRow('Interface Name', escapeHtml(interfaceName))
    + summaryRow('Execution Time', escapeHtml(executionTime))
    + summaryRow('Error', `<span style="color:red;font-weight:bold;">${escapeHtml(error)}</span>`);
  (details || []).forEach((detail, index) => {
    rows += summaryRow(`Detail ${index + 1}`, escapeHtml(detail));
  });

  const body = summaryBox(rows) + actionBox(
    'Please check the application logs for the full stack trace. Common causes are SFTP connectivity issues, ' +
    'an unreachable or misconfigured BTP destination (SFTP_MOBI / SMTP_MOBI), or a database connectivity problem. ' +
    'Resolve the cause and re-trigger the run.'
  );

  return {
    subject: subject || `${interfaceName} -- Run Failed`,
    html: shell({
      banner: meta.banner,
      environment,
      titleHtml: `<h2 style="margin:0;color:${meta.title};">${escapeHtml(interfaceName)} — RUN FAILED</h2>`,
      greetingHtml: greeting,
      bodyHtml: body
    })
  };
}

module.exports = {
  OUTCOME_META,
  escapeHtml,
  outcomeForRun,
  sftpSubject,
  consolidationSubject,
  buildSftpSummaryMail,
  buildConsolidationMail,
  buildRunFailureMail
};
