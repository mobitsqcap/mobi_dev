const BaseFileHandler = require('./BaseFileHandler');
const Constants = require('../utils/Constants');
const StatusCodeUtil = require('../utils/StatusCodeUtil');
const F = StatusCodeUtil.FRIENDLY;

class MasterFileHandler extends BaseFileHandler {
  constructor(deps) {
    super(deps);
  }

  async process(file, executionContext = {}, handlerOpts = {}) {
    let context;
    try {
      context = await this.begin(file, executionContext);
      context = await this.prepare(file, context);
      const existingIdKeys = handlerOpts?.existingIdKeys || new Set();
      const parsed = this.csvService.parse(context.buffer, existingIdKeys);
      await this.markPicked(context, parsed.totalRows, parsed.validCount, parsed.errorCount);

      if (parsed.errorRows && parsed.errorRows.length > 0) {
        const validationError = new Error(`Row validation failed for ${parsed.errorCount} record(s).`);
        validationError.code = '04';
        validationError.errorRows = parsed.errorRows;
        validationError.totalRows = parsed.totalRows;
        validationError.validCount = parsed.validCount;
        validationError.errorCount = parsed.errorCount;

        let inserted = false;
        if (parsed.records && parsed.records.length > 0) {
          try {
            await this.masterUpsertService.upsertBatch(
              parsed.records,
              context.fileLog.FILE_ID,
              file.name,
              context.auditId
            );
            inserted = true;
          } catch (upsertErr) {
            this._handleHanaDuplicateError(upsertErr, parsed.records);
          }
        }

        await this.complete(file, context, {
          totalRows: parsed.totalRows,
          validCount: validationError.validCount,
          errorCount: validationError.errorCount,
          invalidRows: validationError.errorRows,
          validRecords: parsed.records || [],
          inserted
        });
        return;
      }

      let inserted = false;
      if (parsed.records && parsed.records.length > 0) {
        try {
          await this.masterUpsertService.upsertBatch(
            parsed.records,
            context.fileLog.FILE_ID,
            file.name,
            context.auditId
          );
          inserted = true;
        } catch (upsertErr) {
          this._handleHanaDuplicateError(upsertErr, parsed.records);
        }
      }

      await this.complete(file, context, {
        totalRows: parsed.totalRows,
        validCount: parsed.validCount,
        errorCount: parsed.errorCount,
        invalidRows: [],
        validRecords: parsed.records || [],
        inserted
      });
    } catch (error) {
      await this.fail(file, context, error);
    }
  }

  _handleHanaDuplicateError(err, records) {
    const msg = String(err?.message || '').toLowerCase();
    const is301 = err?.code == 301 || msg.includes('unique constraint') || msg.includes('duplicate');
    if (is301) {
      const sampleId = records && records[0] ? records[0].ID : '';
      const dupError = new Error(F.duplicateBpInDb(sampleId || 'ID', '', ''));
      dupError.code = '05'; // DUPLICATE_BP_IN_DATABASE
      dupError.rowNumber = records && records[0] ? records[0]._rowNumber : 1;
      dupError.mobiReferenceId = sampleId;
      throw dupError;
    }
    throw err;
  }
}

module.exports = MasterFileHandler;
