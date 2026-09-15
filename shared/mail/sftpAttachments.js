'use strict';

/**
 * Best-effort download of SFTP error detail (*_text.file) files so they can
 * be attached to the notification mail. A download failure only adds a log
 * line — the mail is still sent with the SFTP folder path + file name.
 */

const path = require('path');

async function downloadErrorAttachments(sftpService, fileResults = [], logs = []) {
  const attachments = [];
  const seen = new Set();
  for (const file of fileResults || []) {
    const remotePath = file && file.errorTextPath;
    if (!remotePath || seen.has(remotePath)) continue;
    seen.add(remotePath);
    try {
      const content = await sftpService.downloadFile(remotePath);
      if (content && content.length) {
        attachments.push({
          filename: path.posix.basename(remotePath),
          content: Buffer.from(content)
        });
        logs.push(`Attached error file ${path.posix.basename(remotePath)} to the notification mail.`);
      }
    } catch (error) {
      logs.push(`Could not attach ${remotePath} to the notification mail: ${error.message}`);
    }
  }
  return attachments;
}

module.exports = { downloadErrorAttachments };
