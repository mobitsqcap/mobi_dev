const path = require('path');
const DateUtil = require('../utils/DateUtil');

class ErrorFileHandler {
  constructor(sftpService) {
    this.sftpService = sftpService;
  }

  _resolveErrorDirectory(file, context = {}) {
    return (
      context?.paths?.ERROR_PATH ||
      file?.paths?.ERROR_PATH ||
      (context.errorPath ? path.posix.dirname(context.errorPath) : null)
    );
  }

  _resolveErrorFilePath(file, context = {}) {
    if (context?.errorPath) return context.errorPath;
    const dir = this._resolveErrorDirectory(file, context);
    return dir ? `${dir}/${file.name}` : null;
  }

  _resolveProcessingFilePath(file, context = {}) {
    if (context?.processingPath) return context.processingPath;
    const dir = context?.paths?.PROCESSING_PATH || file?.paths?.PROCESSING_PATH;
    return dir ? `${dir}/${file.name}` : null;
  }

  _resolveFileInPath(file, context = {}) {
    const dir = context?.paths?.FILEIN_PATH || file?.paths?.FILEIN_PATH;
    return dir ? `${dir}/${file.name}` : null;
  }

  async handle(file, error, context = {}) {
    const target = this._resolveErrorFilePath(file, context);
    const errorDirectory = this._resolveErrorDirectory(file, context);
    if (!target || !errorDirectory) {
      throw new Error(`ERROR path missing for file ${file.name}. Please check SFTP folder configuration.`);
    }

    // 1. Collect all candidate source paths where the CSV could be sitting on SFTP
    const candidates = [
      ...new Set([
        file.path,
        context?.processingPath,
        this._resolveProcessingFilePath(file, context),
        this._resolveFileInPath(file, context),
        file?.paths?.FILEIN_PATH ? `${file.paths.FILEIN_PATH}/${file.name}` : null,
        file?.paths?.PROCESSING_PATH ? `${file.paths.PROCESSING_PATH}/${file.name}` : null,
        context?.paths?.FILEIN_PATH ? `${context.paths.FILEIN_PATH}/${file.name}` : null,
        context?.paths?.PROCESSING_PATH ? `${context.paths.PROCESSING_PATH}/${file.name}` : null
      ].filter(Boolean))
    ];

    let moveError = null;
    let moved = false;
    for (const src of candidates) {
      try {
        await this.sftpService.moveFile(src, target);
        file.path = target;
        moved = true;
        moveError = null;
        break;
      } catch (e) {
        moveError = e;
      }
    }

    if (!moved) {
      try {
        if (context?.buffer) {
          await this.sftpService.uploadFile(target, context.buffer);
          file.path = target;
          moved = true;
          console.log(`[ErrorFileHandler] Uploaded original CSV buffer directly to ERROR folder: ${target}`);
        } else {
          for (const src of candidates) {
            try {
              const buf = await this.sftpService.downloadFile(src);
              if (buf && buf.length > 0) {
                await this.sftpService.uploadFile(target, buf);
                await this.sftpService.deleteFile(src);
                file.path = target;
                moved = true;
                break;
              }
            } catch (_) {}
          }
        }
      } catch (fallbackErr) {
        console.error(`[ErrorFileHandler] Failsafe CSV upload to ERROR folder failed:`, fallbackErr.message);
      }
    }

    // Always write text error file even if the move failed
    const textBuf = this._buildErrorTextFile(file, error, context, moveError);
    const textName = this._buildErrorTextFileName(file.name);
    const textPath = `${errorDirectory}/${textName}`;
    try {
      await this.sftpService.uploadFile(textPath, textBuf);
    } catch (uploadErr) {
      console.error('[ErrorFileHandler] Failed to upload error text file', uploadErr);
    }

    console.error(`[ErrorFileHandler] ${file.name} moved to error. Reason: ${error.message}`);
    return {
      errorPath: target,
      errorTextPath: textPath,
      moveError: !moved && moveError ? moveError.message : null
    };
  }

  _buildErrorTextFileName(originalName) {
    const dot = originalName.lastIndexOf('.');
    const base = dot >= 0 ? originalName.slice(0, dot) : originalName;
    return `${base}_text.file`;
  }

  _buildErrorTextFile(file, error, context, moveError = null) {
    const auditId = context?.auditId || context?.fileLog?.AUDIT_ID || '';
    const lines = [
      `FILE NAME       : ${file.name}`,
      `AUDIT ID        : ${auditId}`,
      `ERROR CODE      : ${error.code || 'FILE_PROCESSING_ERROR'}`,
      `ERROR DETAIL    : ${this._sanitize(error.message || '')}`,
      !file.path || moveError
        ? `MOVE WARNING    : Source file could not be moved to ERROR folder (${this._sanitize(moveError?.message || '')}); audit log has been updated.`
        : '',
      `GENERATED AT    : ${DateUtil.nowTimestamp()}`,
      '',
      'S.NO | AUDIT_ID | ROW_NO | MOBI_REFERENCE_ID | ERROR_CODE | ERROR_DETAIL'
    ].filter(Boolean);

    let rows = [];
    if (Array.isArray(error?.errorRows)) {
      rows = error.errorRows;
    } else {
      rows = [
        {
          rowNo: error?.rowNumber || '',
          mobiReferenceId: error?.mobiReferenceId || '',
          errorCode: error?.code || '',
          errorDetail: error?.message || ''
        }
      ];
    }

    rows.forEach((r, i) => {
      lines.push(
        [
          i + 1,
          auditId,
          r.rowNo || '',
          r.mobiReferenceId || '',
          r.errorCode || error.code || '',
          this._sanitize(r.errorDetail || error.message || '')
        ].join(' | ')
      );
    });

    return Buffer.from(lines.join('\n'), 'utf-8');
  }

  _sanitize(v) {
    return String(v || '')
      .replace(/[\r\n]+/g, ' ')
      .trim();
  }
}

module.exports = ErrorFileHandler;
