const FileTypeUtil = require('../utils/FileTypeUtil');
const ValidationError = require('../models/ValidationError');
const Constants = require('../utils/Constants');
const StatusCodeUtil = require('../utils/StatusCodeUtil');
const F = StatusCodeUtil.FRIENDLY;

class UnifiedIngestionHandler {
  constructor({
    sftpService,
    errorFileHandler,
    fileLogRepository,
    auditRepository,
    masterFileHandler,
    masterRepository,
    masterCsvService
  }) {
    Object.assign(this, {
      sftpService,
      errorFileHandler,
      fileLogRepository,
      auditRepository,
      masterFileHandler,
      masterRepository,
      masterCsvService
    });
  }

  async handle(executionContext = {}) {
    const logs = [];
    const masterFiles = await this._loadMasterFiles(logs);
    const masterClassified = this._classify(masterFiles, 'MASTER');
    logs.push(`Master: ${masterClassified.valid.length} valid, ${masterClassified.invalid.length} invalid`);
    await this._processInvalidFiles(masterClassified.invalid, executionContext, 'MASTER', logs);

    const existingIdKeys = await this._loadExistingIdKeys(logs);
    logs.push(`Loaded ${existingIdKeys.size} existing master ID(s) for duplicate check`);

    for (const file of FileTypeUtil.sortForProcessing(masterClassified.valid)) {
      logs.push(`Processing MASTER: ${file.name}`);
      file.existingIdKeys = existingIdKeys;
      await this.masterFileHandler.process(file, executionContext, { existingIdKeys });
    }

    return { filesProcessed: masterFiles.length, logs };
  }

  async handleMasterOnly(ctx) {
    return this.handle(ctx);
  }

  async _loadExistingIdKeys(logs) {
    try {
      const cds = require('@sap/cds');
      const { SELECT } = cds.ql;
      const dbSvc = await cds.connect.to('db');
      const rows = await dbSvc.run(
        SELECT.from('mobi.db.MOBI_DB_MASTER')
          .columns('MOBI_PORTAL_CODE', 'SAP_COMPANY_CODE', 'ID')
          .where({ ACTIVE_FLAG: Constants.ACTIVE_FLAG })
      );
      const keySet = new Set();
      for (const r of rows || []) {
        const portal = String(r.MOBI_PORTAL_CODE || '').trim().toUpperCase();
        const company = String(r.SAP_COMPANY_CODE || '').trim();
        const id = String(r.ID || '').trim().toUpperCase();
        if (portal && company && id) keySet.add(`${portal}|${company}|${id}`);
      }
      return keySet;
    } catch (e) {
      logs.push(`Could not preload existing master keys: ${e.message}`);
      return new Set();
    }
  }

  async _loadMasterFiles(logs) {
    return this._listWithContext(Constants.SFTP.MASTER, Constants.SFTP.MASTER.FILEIN_PATH, 'filein', logs);
  }

  async _processInvalidFiles(files, executionContext, expectedType, logs) {
    // Master flow ALWAYS records SYSTEM_SFTP as the creator, regardless of who triggered the run
    const actor = Constants.SYSTEM_USERS.SFTP || executionContext.actor || Constants.SYSTEM_USERS.DEFAULT;
    const runId = executionContext.runId || 'MANUAL_RUN';

    for (const invalidFile of files) {
      logs.push(`Invalid ${expectedType} filename: ${invalidFile.name}`);
      const fileLog = await this.fileLogRepository.ensureTracked(invalidFile, actor);
      await this.auditRepository.start({
        auditId: fileLog.AUDIT_ID,
        runId,
        fileName: invalidFile.name,
        createdBy: actor
      });

      const expected = FileTypeUtil.expectedFormat(expectedType);
      const error = new ValidationError(
        StatusCodeUtil.toCode('INVALID_FILE_NAME', '014'),
        F.invalidFileName(invalidFile.name, expected)
      );

      const errorPath = invalidFile?.paths?.ERROR_PATH
        ? `${invalidFile.paths.ERROR_PATH}/${invalidFile.name}`
        : null;
      const processingPath = invalidFile?.paths?.PROCESSING_PATH
        ? `${invalidFile.paths.PROCESSING_PATH}/${invalidFile.name}`
        : null;

      const errRes = await this.errorFileHandler.handle(invalidFile, error, {
        paths: invalidFile.paths,
        errorPath,
        processingPath,
        actor,
        auditId: fileLog.AUDIT_ID,
        fileLog
      });

      const detail = error.message;
      await this.fileLogRepository.markFailed(fileLog.AUDIT_ID, detail, actor, {
        filePath: errRes?.errorPath || errorPath || invalidFile.path,
        sizeBytes: invalidFile.sizeBytes ?? null,
        totalRows: 0,
        validCount: 0,
        errorCount: 0
      });
      await this.auditRepository.fail(
        fileLog.AUDIT_ID,
        error,
        { totalRows: 0, validCount: 0, errorCount: 0 },
        actor,
        {
          errorDetail: detail,
          errorFilePath: errRes?.errorTextPath || null
        }
      );
    }
  }

  _classify(files, expectedType) {
    return files.reduce(
      (g, f) => {
        const t = FileTypeUtil.classify(f.name);
        if (t === expectedType) g.valid.push(f);
        else g.invalid.push(f);
        return g;
      },
      { valid: [], invalid: [] }
    );
  }

  async _listWithContext(paths, directory, source, logs) {
    logs.push(`Scanning: ${directory}`);
    let files = [];
    try {
      files = await this.sftpService.listFiles(directory);
    } catch (error) {
      logs.push(`Could not list ${directory}: ${error.message}`);
      return [];
    }
    logs.push(`Files in ${directory}: ${files.length}`);
    return files.map((f) => ({ ...f, source, paths }));
  }
}

module.exports = UnifiedIngestionHandler;
