'use strict';

const Constants = require('../utils/Constants');
const CsvUtil = require('../utils/CsvUtil');
const DateUtil = require('../utils/DateUtil');

class UnifiedIngestionHandler {
  constructor({ sftpService, transactionFileHandler }) {
    Object.assign(this, { sftpService, transactionFileHandler });
  }

  async handle(executionContext = {}) {
    const logs = [];

    const fileinScan = await this._listFiles(
      Constants.SFTP.TRANSACTION.FILEIN_PATH,
      'filein',
      logs,
      { includeRetryFiles: true, includeInvalid: true }
    );

    const fileinFiles = fileinScan.filter((file) =>
      Constants.FILES.TRANSACTION_REGEX.test(file.name) ||
      Constants.FILES.TRANSACTION_RETRY_REGEX.test(file.name)
    );

    const invalidFiles = fileinScan.filter((file) => !fileinFiles.includes(file));

    const dateValidFiles = [];
    for (const file of fileinFiles) {
      const date8 = DateUtil.extractDate8(file.name);
      if (!date8 || !DateUtil.isValidDate8(date8)) {
        logs.push(`File ${file.name} has an invalid calendar date in its name; selected for rejection.`);
        invalidFiles.push(file);
        continue;
      }
      dateValidFiles.push(file);
    }
    dateValidFiles.sort(
      (a, b) => String(DateUtil.extractDate8(a.name)).localeCompare(String(DateUtil.extractDate8(b.name)))
    );

    const processingFiles = await this._listFiles(
      Constants.SFTP.TRANSACTION.PROCESSING_PATH,
      'processing',
      logs
    );

    const processingByName = new Map(processingFiles.map((file) => [file.name, file]));
    const retryTargets = new Map();
    const newFiles = [];

    for (const file of dateValidFiles) {
      if (Constants.FILES.TRANSACTION_RETRY_REGEX.test(file.name)) {
        const originalName = Constants.RETRY.ORIGINAL_FROM_ERROR_FILE(file.name);
        const processingFile = processingByName.get(originalName);

        if (!processingFile) {
          logs.push(`Retry ${file.name} is invalid because PROCESSING/${originalName} was not found.`);
          invalidFiles.push(file);
          continue;
        }

        const existing = retryTargets.get(originalName);
        if (!existing || /_Updated\.csv$/i.test(file.name)) retryTargets.set(originalName, file);
        logs.push(`Retry ${file.name} matched PROCESSING/${originalName}.`);
        continue;
      }

      if (processingByName.has(file.name)) {
        logs.push(`Normal duplicate ${file.name} will be rejected; use _Updated.csv for retry.`);
      }
      newFiles.push(file);
    }

    const ordered = [
      ...[...retryTargets.entries()].map(([name, retryFile]) => ({
        ...processingByName.get(name),
        source: 'processing',
        retryFile,
        isUpdated: /_Updated\.csv$/i.test(retryFile.name)
      })),
      ...newFiles
    ];

    let filesProcessed = 0;

    logs.push(`Invalid FILE_IN files selected for rejection: ${invalidFiles.length}`);
    for (const file of invalidFiles) {
      logs.push(`Moving invalid file ${file.name} to ERROR.`);
      await this.transactionFileHandler.rejectInvalidFileName(file, executionContext);
      filesProcessed += 1;
    }

    logs.push(`Transaction files selected (sorted by file date ascending): ${ordered.length}`);
    for (const file of ordered) {
      logs.push(`Processing ${file.name} (source=${file.source}).`);

      if (file.source === 'processing' && file.retryFile) {
        const mergeResult = await this._mergeRetryPayload(file, file.retryFile, logs);
        if (!mergeResult.ok) {
          await this.transactionFileHandler.rejectInvalidFileName(
            file.retryFile,
            executionContext,
            {
              statusName: 'CSV_HEADER_MISMATCH',
              detail: `${file.retryFile.name} has an invalid retry-file format: ${mergeResult.error.message}`
            }
          );
          filesProcessed += 1;
          continue;
        }
      }

      await this.transactionFileHandler.process(file, executionContext);
      filesProcessed += 1;
    }

    return { filesProcessed, logs };
  }

  async _mergeRetryPayload(processingFile, retryFile, logs) {
    try {
      const retryBuffer = await this.sftpService.downloadFile(retryFile.path);
      const { headers, rows: updateRows } = CsvUtil.parseNormalized(retryBuffer);

      if (!updateRows.length) throw new Error('Retry file is empty');

      let normalizedRows;

      if (/_Updated\.csv$/i.test(retryFile.name)) {
        const missing = Constants.TRANSACTION_CSV_COLUMNS.filter((header) => !headers.includes(header));
        if (missing.length) {
          throw new Error(`Updated file is not a complete replacement; missing: ${missing.join(', ')}`);
        }
        normalizedRows = updateRows.map((row) => this._normalizeTransactionRow(row));
        logs.push(`Replacing ${processingFile.name} with ${normalizedRows.length} corrected row(s).`);
      } else {
        const processingBuffer = await this.sftpService.downloadFile(processingFile.path);
        const { rows: processingRows } = CsvUtil.parseNormalized(processingBuffer);

        const merged = [...processingRows];

        if (!updateRows.every((row) => String(row.row_number || '').trim())) {
          throw new Error('Retry error CSV must provide row_number for every row');
        }

        for (const retryRow of updateRows) {
          const targetIndex = Number(String(retryRow.row_number).trim()) - 2;
          if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= merged.length) {
            throw new Error(`Invalid row_number ${retryRow.row_number}`);
          }

          const cleaned = { ...retryRow };
          delete cleaned.row_number;
          delete cleaned.error_code;
          delete cleaned.error_message;

          for (const [field, value] of Object.entries(cleaned)) {
            if (String(value ?? '').trim()) merged[targetIndex][field] = value;
          }
        }

        normalizedRows = merged.map((row) => this._normalizeTransactionRow(row));
        logs.push(`Merged ${updateRows.length} corrected row(s) by row_number.`);
      }

      await this.sftpService.uploadFile(
        processingFile.path,
        Buffer.from(CsvUtil.serialize(Constants.TRANSACTION_CSV_COLUMNS, normalizedRows), 'utf8')
      );

      await this.sftpService.deleteFile(retryFile.path);

      return { ok: true };
    } catch (error) {
      logs.push(`Retry merge failed for ${processingFile.name}: ${error.message}. Old payload was not processed.`);
      return { ok: false, error };
    }
  }

  _normalizeTransactionRow(row) {
    return Object.fromEntries(
      Constants.TRANSACTION_CSV_COLUMNS.map((header) => [header, row[header] ?? ''])
    );
  }

  async _listFiles(directory, source, logs, options = {}) {
    logs.push(`Scanning ${directory}.`);

    let files;
    try {
      files = await this.sftpService.listFiles(directory);
    } catch (error) {
      logs.push(`Could not list ${directory}: ${error.message}`);
      return [];
    }

    const selected = options.includeInvalid
      ? files
      : files.filter((file) =>
        Constants.FILES.TRANSACTION_REGEX.test(file.name) ||
        (source === 'filein' && options.includeRetryFiles &&
          Constants.FILES.TRANSACTION_RETRY_REGEX.test(file.name))
      );

    return selected.map((file) => ({
      ...file,
      source,
      paths: Constants.SFTP.TRANSACTION
    }));
  }
}

module.exports = UnifiedIngestionHandler;
