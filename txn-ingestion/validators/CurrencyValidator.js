'use strict';

const StatusCodeUtil = require('../utils/StatusCodeUtil');

const ISO_CURRENCY_REGEX = /^[A-Z]{3}$/;

class CurrencyValidator {
  validate(record) {
    const currency = String(record.TXN_CURRENCY || '').trim().toUpperCase();
    if (!ISO_CURRENCY_REGEX.test(currency)) {
      return {
        valid: false,
        errors: [{
          code: StatusCodeUtil.toCode('INVALID_CURRENCY'),
          message: StatusCodeUtil.FRIENDLY.invalidCurrency(record.TXN_CURRENCY)
        }]
      };
    }
    return { valid: true, errors: [] };
  }
}

module.exports = CurrencyValidator;
