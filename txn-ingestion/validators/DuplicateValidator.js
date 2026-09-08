'use strict';

const StatusCodeUtil = require('../utils/StatusCodeUtil');

class DuplicateValidator {
  constructor(transactionRepository) {
    this.transactionRepository = transactionRepository;
  }

  async prepare(records) {
    // HOST_REFERENCE_ID: NO VALIDATION - skip DB lookup for host references
    const mobiReferences = records.map((record) => record.MOBI_REFERENCE_ID).filter(Boolean);

    const [existingMobi] = await Promise.all([
      this.transactionRepository.findExistingMobiReferenceIds(mobiReferences)
    ]);

    // Return empty hostDays for backward compatibility, but it will not be used
    return { existingMobi, hostDays: new Set() };
  }

  validate(record, prepared) {
    const errors = [];

    if (record.MOBI_REFERENCE_ID && prepared.existingMobi.has(record.MOBI_REFERENCE_ID)) {
      errors.push({
        code: StatusCodeUtil.toCode('MOBI_REFERENCE_EXISTS'),
        message: StatusCodeUtil.FRIENDLY.duplicateMobiRefDb(record.MOBI_REFERENCE_ID)
      });
    }

    // HOST_REFERENCE_ID: NO VALIDATION - duplicate host reference allowed
    // Previously checked HOST_REFERENCE_EXISTS / duplicate per day - removed

    return errors.length ? { valid: false, errors } : { valid: true, errors: [] };
  }

  _hostDay(reference, date) {
    return `${String(reference || '').trim()}|${String(date || '').slice(0, 10)}`;
  }
}

module.exports = DuplicateValidator;
