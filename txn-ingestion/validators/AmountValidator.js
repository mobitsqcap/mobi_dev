'use strict';

const StatusCodeUtil = require('../utils/StatusCodeUtil');

const NUMERIC_FIELDS = [
  'TXN_AMOUNT', 'HOST_MDR_AMOUNT', 'HOST_FEE_PAYABLE', 'MOBI_MDR_AMOUNT',
  'MDR_REVENUE', 'AR_PAYIN', 'AP_PAYIN', 'AP_PAYOUT', 'ORIGINAL_AMOUNT',
  'CONVERSION_RATE'
];

class AmountValidator {
  validate(record) {
    const errors = [];

    if (!Number.isFinite(record.TXN_AMOUNT) || record.TXN_AMOUNT <= 0) {
      errors.push({
        code: StatusCodeUtil.toCode('INVALID_AMOUNT'),
        message: StatusCodeUtil.FRIENDLY.invalidAmount(record._RAW_ROW?.transaction_amount)
      });
    }

    for (const field of NUMERIC_FIELDS.filter((name) => name !== 'TXN_AMOUNT')) {
      if (!Number.isFinite(record[field])) {
        errors.push({
          code: StatusCodeUtil.toCode('INVALID_AMOUNT'),
          message: `${field} must be a valid number.`
        });
      }
    }

    return errors.length ? { valid: false, errors } : { valid: true, errors: [] };
  }
}

module.exports = AmountValidator;
