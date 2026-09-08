const HashUtil = require('../utils/HashUtil');
const ErrorMessageUtil = require('../utils/ErrorMessageUtil');
const StatusCodeUtil = require('../utils/StatusCodeUtil');
const DateUtil = require('../utils/DateUtil');

const F = StatusCodeUtil.FRIENDLY;

/**
 * BaseFileHandler (master ingestion)
 */
class BaseFileHandler {
  constructor({
    sftpService,
    fileHashService,
    csvService,
    masterUpsertService,
    masterRepository,
    fileLogRepository,
    auditRepository,
    successFileHandler,
    errorFileHandler,
    systemUser,
    batchSize
  }) {
    Object.assign(this, {
      sftpService,
      fileHashService,
      csvService,
      masterUpsertService,
      masterRepository,
      fileLogRepository,
      auditRepository,
      successFileHandler,
      errorFileHandler,
      systemUser,
      batchSize: batchSize || Number(process.env.BATCH_SIZE || 2000)
    });
  }

  async begin(file, executionContext = {}) {
    // Master flow ALWAYS records SYSTEM_SFTP as the creator, regardless of who triggered the run
    const actor = this.systemUser || executionContext.actor || 'UNKNOWN_USER';
    const runId = executionContext.runId || file.name;
    const fileLog = await this.fileLogRepository.ensureTracked(file, actor);
    const paths = file.paths;
    if (!paths) {
      throw new Error(`SFTP paths are missing for file ${file.name}. Please check SFTP folder configuration.`);
    }

    const processingPath = paths.PROCESSING_PATH
      ? await this.sftpService.resolvePath(`${paths.PROCESSING_PATH}/${file.name}`)
      : file.path;
    const completedPath = await this.sftpService.resolvePath(`${paths.PROCESSED_PATH}/${file.name}`);
    const errorPathObj = await this.sftpService.resolvePath(`${paths.ERROR_PATH}/${file.name}`);

    await this.auditRepository.start({
      auditId: fileLog.AUDIT_ID,
      runId,
      fileName: file.name,
      createdBy: actor
    });

    return {
      auditId: fileLog.AUDIT_ID,
      fileLog,
      runId,
      processStartAt: DateUtil.nowTimestamp(),
      fileHash: fileLog.FILE_HASH || '',
      buffer: null,
      stats: {
        totalRows: Number(fileLog.ROW_COUNT_TOTAL || 0),
        validCount: Number(fileLog.ROW_COUNT_VALID || 0),
        errorCount: Number(fileLog.ROW_COUNT_ERROR || 0)
      },
      paths,
      processingPath,
      completedPath,
      errorPath: errorPathObj,
      actor
    };
  }

  async prepare(file, context) {
    const buffer = await this.sftpService.downloadFile(file.path);
    const fileHash = HashUtil.sha256(buffer);

    if (await this.fileHashService.isDuplicateFile(fileHash)) {
      const e = new Error('This file has already been processed. Please send a new file.');
      e.code = StatusCodeUtil.toCode('DUPLICATE_FILE', '015');
      throw e;
    }

    if (
      file.source !== 'processing' &&
      context.paths?.PROCESSING_PATH &&
      file.path !== context.processingPath
    ) {
      try {
        await this.sftpService.moveFile(file.path, context.processingPath);
        file.path = context.processingPath;
        file.source = 'processing';
      } catch (error) {
        console.warn(`[BaseFileHandler] Move to PROCESSING skipped for ${file.name}: ${error.message}`);
      }
    }

    await this.fileLogRepository.updateFileDetails(
      context.auditId,
      {
        filePath: file.path,
        fileHash,
        sizeBytes: buffer.length
      },
      context.actor
    );

    return { ...context, buffer, fileHash, sizeBytes: buffer.length };
  }

  async markPicked(context, totalRows, initialValidCount = 0, initialErrorCount = 0) {
    context.stats = { totalRows, validCount: initialValidCount, errorCount: initialErrorCount };
    await this.fileLogRepository.markPicked(
      context.auditId,
      {
        filePath: context.processingPath,
        fileHash: context.fileHash,
        sizeBytes: context.sizeBytes,
        totalRows,
        validCount: initialValidCount,
        errorCount: initialErrorCount
      },
      context.actor
    );
    await this.auditRepository.updateProgress(context.auditId, context.stats, context.actor);
  }

  async updateStats(context, stats) {
    context.stats = {
      totalRows: stats.totalRows ?? context.stats.totalRows,
      validCount: stats.validCount ?? context.stats.validCount,
      errorCount: stats.errorCount ?? context.stats.errorCount
    };
    await this.fileLogRepository.updateProcessingStats(context.auditId, context.stats, context.actor);
    await this.auditRepository.updateProgress(context.auditId, context.stats, context.actor);
  }

  async complete(file, context, result) {
    let errorDetail = '';
    let errorFilePath = null;

    if (result.invalidRows && result.invalidRows.length > 0) {
      // 1. There ARE validation errors: Move CSV and generate text file in ERROR folder ONLY
      // Do NOT move to FILE_OUT folder!
      const validationError = new Error(
        `Row validation failed for ${result.errorCount} record(s). See error text file for details.`
      );
      validationError.code = StatusCodeUtil.toCode('VALIDATION_FAILED', '023');
      validationError.errorRows = result.invalidRows;
      validationError.totalRows = result.totalRows;
      validationError.validCount = result.validCount;
      validationError.errorCount = result.errorCount;

      errorDetail = ErrorMessageUtil.generateFileErrorSummary(
        result.invalidRows,
        result.totalRows,
        result.validCount,
        result.errorCount
      );
      const errRes = await this.errorFileHandler.handle(file, validationError, context);
      errorFilePath = errRes && errRes.errorTextPath;
    } else {
      // 2. There are NO errors (all records valid): Move CSV to FILE_OUT folder ONLY
      await this.successFileHandler.handle(file, result, context);
    }

    await this.fileLogRepository.updateResult(
      context.auditId,
      result,
      context.fileHash,
      context.actor,
      context.completedPath,
      { errorDetail }
    );
    await this.auditRepository.complete(context.auditId, result, context.actor, {
      errorDetail,
      errorFilePath
    });
    await this._auditRecords(context, file, {
      validRecords: result.validRecords || [],
      errorRows: result.invalidRows || [],
      inserted: result.inserted !== false,
      errorFilePath
    });
  }

  async fail(file, context, error) {
    const isTransient = this.sftpService.isTransientError(error);

    if (
      error?.totalRows !== undefined ||
      error?.validCount !== undefined ||
      error?.errorCount !== undefined
    ) {
      context = context || {};
      context.stats = {
        totalRows: error.totalRows ?? context?.stats?.totalRows ?? 0,
        validCount: error.validCount ?? context?.stats?.validCount ?? 0,
        errorCount: error.errorCount ?? context?.stats?.errorCount ?? 0
      };
    }

    let errorFilePath = null;
    let friendlyErrorDetail;
    try {
      friendlyErrorDetail = error.errorRows
        ? ErrorMessageUtil.generateFileErrorSummary(
            error.errorRows,
            context?.stats?.totalRows ?? 0,
            context?.stats?.validCount ?? 0,
            context?.stats?.errorCount ?? 0
          )
        : ErrorMessageUtil.getFriendlyMessage(error.code, error.message);
    } catch (e) {
      friendlyErrorDetail = error.message || 'File processing failed';
    }

    if (!isTransient) {
      try {
        const errRes = await this.errorFileHandler.handle(file, error, context);
        errorFilePath = errRes && errRes.errorPath;
      } catch (errHandlerErr) {
        console.error('[BaseFileHandler] errorFileHandler failed:', errHandlerErr.message);
      }
    }

    const auditId = context?.auditId || context?.fileLog?.AUDIT_ID;
    const actor = context?.actor || this.systemUser || 'UNKNOWN_USER';
    if (auditId) {
      await this.fileLogRepository.markFailed(auditId, friendlyErrorDetail, actor, {
        filePath: isTransient ? file.path : errorFilePath || context?.errorPath,
        fileHash: context?.fileHash,
        sizeBytes: context?.sizeBytes ?? file.sizeBytes,
        totalRows: context?.stats?.totalRows,
        validCount: context?.stats?.validCount,
        errorCount: context?.stats?.errorCount,
        errorCode: error?.code
      });
      await this.auditRepository.fail(auditId, error, context?.stats || {}, actor, {
        errorDetail: friendlyErrorDetail,
        errorFilePath,
        errorCode: error?.code
      });
      if (error?.errorRows?.length) {
        await this._auditRecords(context, file, {
          validRecords: [],
          errorRows: error.errorRows,
          inserted: false,
          errorFilePath
        });
      }
    }
  }

  async _auditRecords(context, file, { validRecords, errorRows, inserted, errorFilePath }) {
    if (process.env.AUDIT_RECORD_LEVEL === 'false') return;
    if (!this.auditRepository.insertRecordRows) return;
    try {
      const written = await this.auditRepository.insertRecordRows({
        auditId: context.auditId, // NEW: audit rows share the file's AUDIT_ID (from MOBI_DB_FILELOG)
        runId: context.runId,
        fileName: file.name,
        validRecords,
        errorRows,
        inserted,
        errorFilePath,
        processStartAt: context.processStartAt,
        changedBy: context.actor
      });
      console.log(`[BaseFileHandler] ${file.name}: ${written} record audit row(s) written`);
    } catch (err) {
      console.error(`[BaseFileHandler] record audit failed for ${file.name}: ${err.message}`);
    }
  }
}

module.exports = BaseFileHandler;
