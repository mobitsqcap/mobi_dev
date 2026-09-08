'use strict';

const path = require('path');

const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');
const HashUtil = require('../utils/HashUtil');
const CsvUtil = require('../utils/CsvUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

class TransactionFileHandler {
  constructor(dependencies) {
    Object.assign(this, dependencies);
  }

  async process(file, executionContext = {}) {
    let context = null;
    try {
      if (
        file.source === 'filein' &&
        !file.isUpdated &&
        await this.fileLogRepository.hasAnyFileName(file.name)
      ) {
        await this.rejectDuplicateFile(file, executionContext);
        return { status: 'REJECTED_DUPLICATE' };
      }

      context = await this.begin(file, executionContext);
      context = await this.prepare(file, context);

      if (
        this.fileHashService &&
        !file.isUpdated &&
        context.fileHash &&
        await this.fileHashService.isDuplicateFile(context.fileHash)
      ) {
        await this.rejectDuplicateFile(file, executionContext, {
          code: StatusCodeUtil.toCode('DUPLICATE_FILE'),
          detail: `Duplicate file content (sha256 ${String(context.fileHash).slice(0, 16)}...). An identical file was already completed; no records were inserted.`
        });
        return { status: 'REJECTED_DUPLICATE' };
      }

      context = await this.parseAndValidate(file, context);
      await this.commitOrWriteOutputs(file, context);

      return { status: context.invalidRecords.length ? 'REJECTED' : 'COMPLETED' };
    } catch (error) {
      await this.handleHardFailure(file, context, error);
      return { status: 'FAILED', error };
    }
  }

  async begin(file, executionContext = {}) {
    if (!file.paths) throw new Error(`SFTP paths missing for file ${file.name}`);

    const actor = executionContext.actor || this.systemUser || Constants.SYSTEM_USERS.SFTP;
    const fileLog = executionContext.forceNewAudit
      ? await this.fileLogRepository.createNewAttempt(file)
      : await this.fileLogRepository.ensureTracked(file);

    const processingPath = file.paths.PROCESSING_PATH
      ? await this.sftpService.resolvePath(`${file.paths.PROCESSING_PATH}/${file.name}`)
      : file.path;

    const completedPath = await this.sftpService.resolvePath(
      `${file.paths.PROCESSED_PATH}/${file.name}`
    );

    const errorPath = await this.sftpService.resolvePath(`${file.paths.ERROR_PATH}/${file.name}`);

    await this.auditRepository.start({
      auditId: fileLog.AUDIT_ID,
      runId: executionContext.runId || file.name,
      fileName: file.name,
      createdBy: actor
    });

    return {
      auditId: fileLog.AUDIT_ID,
      fileLog,
      paths: file.paths,
      processingPath,
      completedPath,
      errorPath,
      actor,
      date8: DateUtil.extractDate8(file.name),
      isRetry: file.source === 'processing'
    };
  }

  async prepare(file, context) {
    let pathToRead = file.path;

    if (
      file.source !== 'processing' &&
      context.paths.PROCESSING_PATH &&
      file.path !== context.processingPath
    ) {
      try {
        await this.sftpService.moveFile(file.path, context.processingPath);
      } catch (cause) {
        throw this._codedError(
          'FILE_MOVE_FAILED',
          StatusCodeUtil.FRIENDLY.fileMoveFailed(file.path, context.processingPath, cause.message),
          cause
        );
      }
      file.path = context.processingPath;
      file.source = 'processing';
      pathToRead = context.processingPath;
    }

    let buffer;
    try {
      buffer = await this.sftpService.downloadFile(pathToRead);
    } catch (cause) {
      throw this._codedError(
        'FILE_DOWNLOAD_FAILED',
        StatusCodeUtil.FRIENDLY.fileDownloadFailed(pathToRead, cause.message),
        cause
      );
    }

    const prepared = {
      ...context,
      buffer,
      sizeBytes: buffer.length,
      fileHash: HashUtil.sha256(buffer)
    };

    await this.fileLogRepository.markPicked(context.auditId, {
      filePath: context.processingPath,
      fileHash: prepared.fileHash,
      sizeBytes: prepared.sizeBytes,
      totalRows: 0,
      validCount: 0,
      errorCount: 0,
      changedBy: context.actor
    });

    await this.auditRepository.markProcessing(context.auditId, {
      totalRows: 0,
      validCount: 0,
      errorCount: 0
    });

    await this.batchProcessingService.resetAttempt(context.auditId);

    return prepared;
  }

  async parseAndValidate(file, context) {
    const parsed = this.csvService.parse(context.buffer, context.auditId);

    parsed.records.forEach((record, index) => {
      record._ROW_NUMBER = index + 2;
      record.AUDIT_ID = context.auditId;
    });

    await this.auditRepository.initializeRows(context.auditId, file.name, parsed.records);

    await this.fileLogRepository.updateProgress(context.auditId, {
      totalRows: parsed.totalRows,
      validCount: 0,
      errorCount: 0,
      changedBy: context.actor
    });

    await this.auditRepository.updateProgress(context.auditId, {
      totalRows: parsed.totalRows,
      validCount: 0,
      errorCount: 0
    });

    const progress = async (stats) => {
      await Promise.all([
        this.fileLogRepository.updateProgress(context.auditId, { ...stats, changedBy: context.actor }),
        this.auditRepository.updateProgress(context.auditId, stats)
      ]);
    };

    const batchResult = await this.batchProcessingService.process(
      parsed.records,
      file.name,
      context.auditId,
      progress
    );

    return {
      ...context,
      totalRows: parsed.totalRows,
      validRecords: batchResult.validRecords || [],
      invalidRecords: batchResult.invalidRows || [],
      allRecords: batchResult.allRecords || parsed.records,
      insertedCount: batchResult.insertedCount || 0
    };
  }

async commitOrWriteOutputs(file, context) {
  const validCount = context.validRecords.length;
  const errorCount = context.invalidRecords.length;
  const result = { totalRows: context.totalRows, validCount, errorCount };

  if (errorCount > 0) {
    const partiallyValid = validCount > 0;

    const detail = `${errorCount} record(s) failed validation. Entire file rejected; ` +
      `${validCount} otherwise-valid record(s) were not inserted.` +
      (partiallyValid ? ' Original payload kept in PROCESSING and copied to PROCESSED.' : '');

    await this.errorFileHandler.handle(file, context.allRecords, {
      paths: context.paths,
      errorPath: context.errorPath,
      auditId: context.auditId,
      date8: context.date8,
      validCount,
      sourceBuffer: context.buffer,
      errorCode: StatusCodeUtil.toCode('VALIDATION_FAILED'),
      errorDetail: detail
    });

    // The file keeps living in PROCESSING for partial rejects.
    let finalPath = context.processingPath;

    if (partiallyValid && context.completedPath) {
      try {
        const payload = context.buffer
          ? context.buffer
          : await this.sftpService.downloadFile(context.processingPath);
        await this.sftpService.uploadFile(context.completedPath, payload);
      } catch (cause) {
        console.warn(
          `[TransactionFileHandler] Could not copy partial file to PROCESSED: ${cause.message}. ` +
          'Source remains in PROCESSING.'
        );
      }
    } else if (context.processingPath) {
      try {
        await this.sftpService.deleteFile(context.processingPath);
      } catch (cause) {
        console.warn(`[TransactionFileHandler] Could not delete rejected source: ${cause.message}`);
      }
    }

    await this.auditRepository.finalizeRows(
      context.auditId,
      file.name,
      context.allRecords,
      { fileRejected: true }
    );

    await this.fileLogRepository.updateResult(
      context.auditId,
      result,
      context.fileHash,
      context.actor,
      finalPath,
      {
        statusCode: StatusCodeUtil.toCode('FAILED'),
        errorCode: StatusCodeUtil.toCode('VALIDATION_FAILED'),
        errorDetail: detail
      }
    );

    return;
  }
  const outputPath = context.completedPath.replace(
    /[^/]+$/,
    Constants.OUTPUT_NAMING.FULL_SUCCESS(
      context.date8 || 'UNKNOWN',
      DateUtil.nowHHMMSS()
    )
  );

  try {
    await this.successFileHandler.handle(file, {
      processingPath: context.processingPath,
      completedPath: outputPath
    });
  } catch (cause) {
    throw this._codedError(
      'FILE_MOVE_FAILED',
      StatusCodeUtil.FRIENDLY.fileMoveFailed(context.processingPath, outputPath, cause.message),
      cause
    );
  }

  await this.auditRepository.finalizeRows(
    context.auditId,
    file.name,
    context.allRecords,
    { fileRejected: false }
  );

  await this.fileLogRepository.updateResult(
    context.auditId,
    result,
    context.fileHash,
    context.actor,
    outputPath,
    { statusCode: StatusCodeUtil.toCode('COMPLETED'), errorDetail: '' }
  );
}
  async rejectDuplicateFile(file, executionContext = {}, rejection = {}) {
    const context = await this.begin(file, { ...executionContext, forceNewAudit: true });

    let buffer;
    try {
      buffer = await this.sftpService.downloadFile(file.path);
    } catch (cause) {
      throw this._codedError('FILE_DOWNLOAD_FAILED', cause.message, cause);
    }

    const parsed = CsvUtil.parseNormalized(buffer);

    const duplicateCode = rejection.code || StatusCodeUtil.toCode('DUPLICATE_FILE_NAME');
    const detail = rejection.detail ||
      (`Duplicate file name: ${file.name}. No records were inserted.` +
        'Use Transactions_YYYYMMDD_Updated.csv for a corrected replacement.');

    const rows = parsed.rows.map((raw, index) => ({
      _RAW_ROW: raw,
      _ROW_NUMBER: index + 2,
      _FILE_LEVEL_ERROR: true,
      ROW_STATUS: Constants.ROW_STATUS.INVALID,
      STATUS_CODE: duplicateCode,
      STATUS_MESSAGE: detail
    }));

    let finalPath = file.path;
    try {
      await this.sftpService.moveFile(file.path, context.errorPath);
      finalPath = context.errorPath;
      file.path = finalPath;
    } catch (error) {
      console.warn(`[TransactionFileHandler] Could not move duplicate input: ${error.message}`);
    }

    await this.errorFileHandler.handle(file, rows, {
      paths: context.paths,
      errorPath: context.errorPath,
      auditId: context.auditId,
      date8: context.date8,
      validCount: 0,
      sourceBuffer: buffer,
      errorCode: duplicateCode,
      errorDetail: detail,
      fileLevelFailure: true
    });

    const result = { totalRows: rows.length, validCount: 0, errorCount: rows.length };
    await this.fileLogRepository.updateResult(
      context.auditId,
      result,
      HashUtil.sha256(buffer),
      context.actor,
      finalPath,
      {
        statusCode: StatusCodeUtil.toCode('FAILED'),
        errorCode: duplicateCode,
        errorDetail: detail
      }
    );

    await this.auditRepository.recordFileFailure(
      context.auditId,
      file.name,
      parsed.rows,
      { code: duplicateCode, message: detail }
    );
  }

  async rejectInvalidFileName(file, executionContext = {}, rejection = {}) {
    let context = null;
    try {
      context = await this.begin(file, { ...executionContext, forceNewAudit: true });

      let buffer;
      try {
        buffer = await this.sftpService.downloadFile(file.path);
      } catch (cause) {
        throw this._codedError(
          'FILE_DOWNLOAD_FAILED',
          StatusCodeUtil.FRIENDLY.fileDownloadFailed(file.path, cause.message),
          cause
        );
      }

      context = {
        ...context,
        buffer,
        sizeBytes: buffer.length,
        fileHash: HashUtil.sha256(buffer)
      };

      const statusName = rejection.statusName || 'INVALID_FILE_NAME';
      const invalidCode = StatusCodeUtil.toCode(statusName);

      const detail = rejection.detail ||
        (`${file.name} does not match the expected pattern for the selected ingestion flow.` +
        'Expected Transactions_YYYYMMDD.csv (with a valid calendar date) or a retry file matched to an existing PROCESSING file.');

      const row = {
        _FILE_LEVEL_ERROR: true,
        _ROW_NUMBER: '',
        ROW_STATUS: Constants.ROW_STATUS.INVALID,
        STATUS_CODE: invalidCode,
        STATUS_MESSAGE: detail
      };

      try {
        await this.sftpService.moveFile(file.path, context.errorPath);
      } catch (cause) {
        throw this._codedError(
          'FILE_MOVE_FAILED',
          StatusCodeUtil.FRIENDLY.fileMoveFailed(file.path, context.errorPath, cause.message),
          cause
        );
      }

      file.path = context.errorPath;

      await this.errorFileHandler.handle(file, [row], {
        paths: context.paths,
        errorPath: context.errorPath,
        auditId: context.auditId,
        date8: context.date8,
        validCount: 0,
        errorCode: invalidCode,
        errorDetail: detail,
        fileLevelFailure: true,
        sourceBaseNaming: true,
        skipErrorCsv: true
      });

      const result = { totalRows: 0, validCount: 0, errorCount: 1 };
      await this.fileLogRepository.updateResult(
        context.auditId,
        result,
        HashUtil.sha256(buffer),
        context.actor,
        context.errorPath,
        {
          statusCode: StatusCodeUtil.toCode('FAILED'),
          errorCode: invalidCode,
          errorDetail: detail
        }
      );

      await this.auditRepository.recordFileFailure(
        context.auditId,
        file.name,
        [],
        { code: invalidCode, message: detail }
      );

      return { status: StatusCodeUtil.toText(invalidCode) };
    } catch (error) {
      await this.handleHardFailure(file, context, error);
      return { status: 'FAILED', error };
    }
  }

  async handleHardFailure(file, context, error) {
    if (!context?.auditId) {
      console.error(`[TransactionFileHandler] ${file?.name || 'unknown'} failed: ${error.message}`);
      return;
    }

    const code = StatusCodeUtil.normalizeCode(error.code, 'UNKNOWN_ERROR');
    const totalRows = error.totalRows ?? context.totalRows ?? 0;
    const errorCount = error.errorCount ?? totalRows;

    const rawRows = (error.rawRows || []).map((raw, index) => ({
      _RAW_ROW: raw,
      _ROW_NUMBER: index + 2,
      _FILE_LEVEL_ERROR: true,
      ROW_STATUS: Constants.ROW_STATUS.INVALID,
      STATUS_CODE: code,
      STATUS_MESSAGE: error.message
    }));

    try {
      await this.errorFileHandler.handle(file, rawRows, {
        paths: context.paths,
        errorPath: context.errorPath,
        auditId: context.auditId,
        date8: context.date8,
        validCount: 0,
        sourceBuffer: context.buffer,
        errorCode: code,
        errorDetail: error.message,
        fileLevelFailure: true
      });
    } catch (writeError) {
      console.warn(`[TransactionFileHandler] Could not write error report: ${writeError.message}`);
    }

    try {
      await this.fileLogRepository.markFailed(context.auditId, error.message, context.actor, {
        errorCode: code,
        filePath: file?.path || context.processingPath,
        fileHash: context.fileHash || '',
        sizeBytes: context.sizeBytes ?? file?.sizeBytes ?? 0,
        totalRows,
        validCount: 0,
        errorCount
      });
    } catch (logError) {
      console.error(`[TransactionFileHandler] FILELOG failure: ${logError.message}`);
    }

    try {
      await this.auditRepository.recordFileFailure(
        context.auditId,
        file.name,
        error.rawRows || [],
        { code, message: error.message }
      );
    } catch (auditError) {
      console.error(`[TransactionFileHandler] AUDIT failure: ${auditError.message}`);
    }
  }

  _codedError(statusName, message, cause) {
    const error = new Error(message, cause ? { cause } : undefined);
    error.code = StatusCodeUtil.toCode(statusName);
    return error;
  }
}

module.exports = TransactionFileHandler;
