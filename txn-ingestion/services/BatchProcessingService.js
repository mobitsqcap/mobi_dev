'use strict';

const Constants = require('../utils/Constants');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

class BatchProcessingService {
  constructor({ validationService, transactionService, fileBatchRepository }) {
    Object.assign(this, { validationService, transactionService, fileBatchRepository });
    this.batchSize = Constants.BATCH_SIZE;
  }

  async resetAttempt(auditId) {
    await this.fileBatchRepository.clearForAttempt(auditId);
  }

  async process(records, fileName, auditId, onProgress = null) {
    const allRecords = [];
    const validRecords = [];
    const invalidRows = [];
    const validationContext =
      typeof this.validationService?.createContext === 'function'
        ? this.validationService.createContext()
        : { mobiReferencesSeen: new Set(), masterIndex: null };

    for (let startIndex = 0, batchNo = 1; startIndex < records.length; startIndex += this.batchSize, batchNo += 1) {
      const batchRows = records.slice(startIndex, startIndex + this.batchSize);
      const endIndex = startIndex + batchRows.length;

      await this.fileBatchRepository.markStarted(
        auditId,
        batchNo,
        fileName,
        startIndex,
        endIndex,
        batchRows.length
      );

      try {
        const validatedRows = await this.validationService.validateBatch(batchRows, validationContext);
        validatedRows.forEach((row, offset) => {
          row._ROW_NUMBER = startIndex + offset + 2;
        });

        const valid = validatedRows.filter((row) => row.ROW_STATUS === Constants.ROW_STATUS.VALID);
        const invalid = validatedRows.filter((row) => row.ROW_STATUS === Constants.ROW_STATUS.INVALID);

        allRecords.push(...validatedRows);
        validRecords.push(...valid);
        invalidRows.push(...invalid);

        await this.fileBatchRepository.markCompleted(
          auditId,
          batchNo,
          valid.length,
          invalid.length,
          invalid.length ? `${invalid.length} row(s) failed validation` : ''
        );

        if (onProgress) {
          await onProgress({
            totalRows: records.length,
            validCount: validRecords.length,
            errorCount: invalidRows.length
          });
        }
      } catch (error) {
        await this.fileBatchRepository.markCompleted(
          auditId,
          batchNo,
          0,
          batchRows.length,
          error.message
        );
        error.totalRows = records.length;
        error.validCount = 0;
        error.errorCount = records.length;
        error.rawRows = records.map((record) => record._RAW_ROW || {});
        throw error;
      }
    }

    // File-level rules still REJECT THE FILE (nothing inserted),
    // but errors are attached only to the rows that actually violate them.
    // 064: mixed txn_paid_date → only rows whose date is not the majority date
    // 065: balance_check ≠ 0    → only those rows
    // Clean rows are skipped in the error text file / audit error list.
    if (allRecords.length > 0) {
      const distinctPaidDates = [...new Set(
        allRecords.map((r) => String(r.TXN_PAID_DATE || '').trim().slice(0, 10))
      )];
      const paidDateInconsistent = distinctPaidDates.length > 1;
      const majorityPaidDate = paidDateInconsistent
        ? this._majorityPaidDate(allRecords)
        : null;

      const paidDateError = paidDateInconsistent
        ? {
          code: StatusCodeUtil.toCode('INVALID_TXN_PAID_DATE'),
          message: StatusCodeUtil.FRIENDLY.invalidPaidDate(distinctPaidDates)
        }
        : null;

      const balanceErrorTemplate = {
        code: StatusCodeUtil.toCode('INVALID_BALANCE_CHECK'),
        message: StatusCodeUtil.FRIENDLY.invalidBalanceCheck(
          [...new Set(
            allRecords.map((r) => String((r._RAW_ROW || {}).balance_check ?? '').trim())
          )]
        )
      };

      let fileLevelTriggered = false;

      for (const rec of allRecords) {
        const extra = [];

        if (paidDateError) {
          const rowDate = String(rec.TXN_PAID_DATE || '').trim().slice(0, 10);
          if (rowDate !== majorityPaidDate) extra.push(paidDateError);
        }

        const balanceOk = Number.isFinite(rec.BALANCE_CHECK) && rec.BALANCE_CHECK === 0;
        if (!balanceOk) extra.push(balanceErrorTemplate);

        if (!extra.length) continue;

        fileLevelTriggered = true;
        const existingErrors = rec._VALIDATION_ERRORS || [];
        const merged = [
          ...existingErrors,
          ...extra.filter((fe) =>
            !existingErrors.some(
              (e) => StatusCodeUtil.normalizeCode(e.code) === StatusCodeUtil.normalizeCode(fe.code)
            )
          )
        ];
        rec.ROW_STATUS = Constants.ROW_STATUS.INVALID;
        rec.STATUS_CODE = StatusCodeUtil.joinErrorCodes(merged);
        rec.STATUS_MESSAGE = StatusCodeUtil.concatErrorDetail(merged).slice(0, 500);
        rec._VALIDATION_ERRORS = merged;
      }

      validRecords.length = 0;
      invalidRows.length = 0;
      for (const rec of allRecords) {
        if (rec.ROW_STATUS === Constants.ROW_STATUS.INVALID) invalidRows.push(rec);
        else validRecords.push(rec);
      }

      if (fileLevelTriggered) {
        try {
          const detail = [
            paidDateError?.message,
            allRecords.some((r) => !(Number.isFinite(r.BALANCE_CHECK) && r.BALANCE_CHECK === 0))
              ? balanceErrorTemplate.message
              : ''
          ].filter(Boolean).join(' || ').slice(0, 255);
          await this.fileBatchRepository.markAllFailed(auditId, detail);
        } catch (_) {
          // non-critical; file is still rejected via invalidRows
        }

        if (onProgress) {
          await onProgress({
            totalRows: records.length,
            validCount: validRecords.length,
            errorCount: invalidRows.length
          });
        }
      }
    }

    if (invalidRows.length) {
      return {
        totalRows: records.length,
        validRecords,
        invalidRows,
        allRecords,
        insertedCount: 0
      };
    }

    try {
      await this._insertAllWithRetry(validRecords);
    } catch (error) {
      error.code = StatusCodeUtil.normalizeCode(error.code, 'TRANSACTION_FAILED');
      error.totalRows = records.length;
      error.validCount = 0;
      error.errorCount = records.length;
      error.rawRows = records.map((record) => record._RAW_ROW || {});
      await this.fileBatchRepository.markAllFailed(auditId, error.message);
      throw error;
    }

    return {
      totalRows: records.length,
      validRecords,
      invalidRows,
      allRecords,
      insertedCount: validRecords.length
    };
  }

  _majorityPaidDate(records) {
    const counts = new Map();
    const order = [];
    for (const rec of records) {
      const date = String(rec.TXN_PAID_DATE || '').trim().slice(0, 10);
      if (!counts.has(date)) order.push(date);
      counts.set(date, (counts.get(date) || 0) + 1);
    }
    let best = order[0] || '';
    let bestCount = 0;
    for (const date of order) {
      const count = counts.get(date) || 0;
      if (count > bestCount) {
        best = date;
        bestCount = count;
      }
    }
    return best;
  }

  async _insertAllWithRetry(records, attempt = 1) {
    try {
      await this.transactionService.insertAllAtomic(records, this.batchSize);
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      return this._insertAllWithRetry(records, attempt + 1);
    }
  }
}

module.exports = BatchProcessingService;
