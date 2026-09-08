'use strict';

const Constants = require('../utils/Constants');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

const ALLOWED_STATUS = new Set(['SUCCESS', 'FAILED', 'PENDING', 'RETURN', 'FAILURE']);

class BusinessValidator {
  validate(record) {
    const errors = [];

    const status = String(record.TXN_STATUS || '').trim().toUpperCase();
    const type = String(record.PAYMENT_TYPE || '').trim().toUpperCase();
    const subtype = String(record.PAYMENT_SUB_TYPE || '').trim().toUpperCase();
    const payment = Constants.PAYMENT;

    if (!ALLOWED_STATUS.has(status)) {
      errors.push({
        code: StatusCodeUtil.toCode('INVALID_TRANSACTION_STATUS'),
        message: StatusCodeUtil.FRIENDLY.invalidTxnStatus(record.TXN_STATUS, [...ALLOWED_STATUS])
      });
    }

    if (payment.PAYIN_TYPE_ALIASES.has(type)) {
      if (!payment.PAYIN_SUBTYPE_ALIASES.has(subtype)) {
        errors.push({
          code: StatusCodeUtil.toCode('INVALID_PAYMENT_SUBTYPE'),
          message: StatusCodeUtil.FRIENDLY.invalidPaymentSubType(
            record.PAYMENT_SUB_TYPE,
            [...payment.PAYIN_SUBTYPE_ALIASES]
          )
        });
      }
    } else if (payment.PAYOUT_TYPE_ALIASES.has(type)) {
      const allowed = new Set([...payment.PAYOUT_SUBTYPE_ALIASES, ...payment.DS_SUBTYPE_ALIASES]);
      if (!allowed.has(subtype)) {
        errors.push({
          code: StatusCodeUtil.toCode('INVALID_PAYMENT_SUBTYPE'),
          message: StatusCodeUtil.FRIENDLY.invalidPaymentSubType(record.PAYMENT_SUB_TYPE, [...allowed])
        });
      }
    } else {
      errors.push({
        code: StatusCodeUtil.toCode('INVALID_PAYMENT_TYPE'),
        message: StatusCodeUtil.FRIENDLY.invalidPaymentType(
          record.PAYMENT_TYPE,
          [...payment.PAYIN_TYPE_ALIASES, ...payment.PAYOUT_TYPE_ALIASES]
        )
      });
    }

    return errors.length ? { valid: false, errors } : { valid: true, errors: [] };
  }
}

module.exports = BusinessValidator;
