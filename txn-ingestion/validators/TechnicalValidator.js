'use strict';

const Constants = require('../utils/Constants');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

const EXPONENTIAL_NUMBER =
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d+$/;

class TechnicalValidator {
  validate(record) {
    const errors = [];

    if (record._DATE_ERRORS?.length) {
      errors.push({
        code: StatusCodeUtil.toCode('INVALID_DATE'),
        message: record._DATE_ERRORS.join(' || ')
      });
    }

    const missingCode = StatusCodeUtil.toCode('MISSING_REQUIRED_FIELD');

    const required = [
      ['SAP_COMPANY_CODE', record.COMPANY_CODE],
      ['MOBI_PORTAL_CODE', record.MOBI_PORTAL_CODE],
      ['PAYMENT_TYPE', record.PAYMENT_TYPE],
      ['PAYMENT_SUB_TYPE', record.PAYMENT_SUB_TYPE],
      ['MOBI_REFERENCE_ID', record.MOBI_REFERENCE_ID],
      ['MERCHANT_ID', record.MERCHANT_ID],
      ['HOST_NAME', record.HOST_NAME],

      // BALANCE_CHECK is required.
      // Use the raw value so blank and 0 can be distinguished.
      ['BALANCE_CHECK', record._BALANCE_CHECK_RAW]
    ];

    for (const [field, value] of required) {
      if (!String(value || '').trim()) {
        errors.push({
          code: missingCode,
          message: StatusCodeUtil.FRIENDLY.missingField(field)
        });
      }
    }

    // BALANCE_CHECK must be a valid number when provided.
    const balanceCheckRaw = String(
      record._BALANCE_CHECK_RAW || ''
    ).trim();

    if (balanceCheckRaw) {
      const num = Number(balanceCheckRaw.replace(/,/g, ''));

      if (Number.isNaN(num)) {
        errors.push({
          code: StatusCodeUtil.toCode('INVALID_TYPE'),
          message: 'BALANCE_CHECK must be a valid number.'
        });
      }
    }

    const companyCode = String(record.COMPANY_CODE || '').trim();

    if (
      companyCode &&
      !Constants.ALLOWED_COMPANY_CODES.has(companyCode)
    ) {
      errors.push({
        code: StatusCodeUtil.toCode('INVALID_COMPANY'),
        message: StatusCodeUtil.FRIENDLY.invalidCompany(
          companyCode,
          [...Constants.ALLOWED_COMPANY_CODES]
        )
      });
    }

    const portalCode = String(
      record.MOBI_PORTAL_CODE || ''
    ).trim().toUpperCase();

    if (
      portalCode &&
      !Constants.VALID_PORTAL_CODES.has(portalCode)
    ) {
      errors.push({
        code: StatusCodeUtil.toCode('INVALID_PORTAL'),
        message: StatusCodeUtil.FRIENDLY.invalidPortal(
          record.MOBI_PORTAL_CODE,
          [...Constants.VALID_PORTAL_CODES]
        )
      });
    }

    // HOST_REFERENCE_ID: NO VALIDATION
    // Only MOBI_REFERENCE_ID is validated for length / exponential format.
    const mobiRef = String(
      record.MOBI_REFERENCE_ID || ''
    ).trim();

    if (mobiRef.length > Constants.MAX_REF_ID_LENGTH) {
      errors.push({
        code: StatusCodeUtil.toCode('REFERENCE_TOO_LONG'),
        message: StatusCodeUtil.FRIENDLY.refTooLong(
          'MOBI_REFERENCE_ID',
          Constants.MAX_REF_ID_LENGTH
        )
      });
    }

    if (EXPONENTIAL_NUMBER.test(mobiRef)) {
      errors.push({
        code: StatusCodeUtil.toCode('EXPONENTIAL_REFERENCE'),
        message: StatusCodeUtil.FRIENDLY.exponentialRef(
          'MOBI_REFERENCE_ID',
          mobiRef
        )
      });
    }

    return errors.length
      ? { valid: false, errors }
      : { valid: true, errors: [] };
  }
}

module.exports = TechnicalValidator;