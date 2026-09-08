const Constants = require('../utils/Constants');
const StatusCodeUtil = require('../utils/StatusCodeUtil');
const F = StatusCodeUtil.FRIENDLY;

class MasterValidator {
  validateRecords(records, { existingIdKeys = new Set() } = {}) {
    const validRecords = [];
    const errorRows = [];

    // Within-batch duplicate detection (case-insensitive)
    const batchIdNormalised = new Map(); // normalisedId -> true

    for (const record of records) {
      const id = (record.ID || '').toString();
      const normId = id.trim().toUpperCase();
      const company = (record.SAP_COMPANY_CODE || '').toString().trim();
      const portal = (record.MOBI_PORTAL_CODE || '').toString().trim().toUpperCase();
      const composite = `${portal}|${company}|${normId}`;

      const recordErrors = [];

      // Within-batch duplicates
      if (batchIdNormalised.has(normId)) {
        recordErrors.push({
          code: Constants.ERROR_CODES.DUPLICATE_ID_IN_BATCH,
          message: F.duplicateIdInBatch(id)
        });
      } else {
        batchIdNormalised.set(normId, true);
      }

      // Case-insensitive conflict with existing master data (same portal+company)
      if (existingIdKeys.has(composite)) {
        recordErrors.push({
          code: Constants.ERROR_CODES.DUPLICATE_BP_IN_DATABASE,
          message: F.duplicateBpInDb(id)
        });
      }

      // Run per-field validation (collects all errors)
      recordErrors.push(...this._validateOne(record));

      if (recordErrors.length > 0) {
        errorRows.push({
          rowNo: record._rowNumber || '',
          mobiReferenceId: record._rawId || id || '',
          errorCode: StatusCodeUtil.joinErrorCodes(recordErrors),
          errorDetail: StatusCodeUtil.joinErrorDetails(recordErrors)
        });
      } else {
        const {
          TYPE_RAW, MOBI_PORTAL_CODE_RAW, SAP_COMPANY_CODE_RAW,
          COUNTRY_CODE_RAW, MASTER_NAME_RAW, ADDRESS1_RAW,
          BUSINESS_REG_NO_TIN_RAW, EXTERNAL_BP_NUMBER_RAW, BP_NUMBER_RAW,
          _rowNumber, _rawId, ...clean
        } = record;

        Object.defineProperty(clean, '_rowNumber', { value: _rowNumber, enumerable: false });
        validRecords.push(clean);
      }
    }
    return { validRecords, errorRows };
  }

  _validateOne(record) {
    const errors = [];
    const limits = Constants.FIELD_LIMITS;
    const mandatory = Constants.MANDATORY_FIELDS;

    // 1) Mandatory field checks
    for (const field of mandatory) {
      const value = record[field];
      if (value === undefined || value === null ||
        String(value).trim() === '' || String(value).trim() === ' ') {
        errors.push({
          code: Constants.ERROR_CODES.MANDATORY_FIELD_MISSING,
          message: F.missingField(field)
        });
      }
    }

    // 2) Field length checks
    this._checkLength(errors, 'ID', record._rawId, limits.ID);
    this._checkLength(errors, 'MOBI_PORTAL_CODE', record.MOBI_PORTAL_CODE_RAW, limits.MOBI_PORTAL_CODE);
    this._checkLength(errors, 'SAP_COMPANY_CODE', record.SAP_COMPANY_CODE_RAW, limits.SAP_COMPANY_CODE);
    this._checkLength(errors, 'TYPE', record.TYPE_RAW, limits.TYPE);
    this._checkLength(errors, 'MASTER_NAME', record.MASTER_NAME_RAW, limits.MASTER_NAME);
    this._checkLength(errors, 'ADDRESS1', record.ADDRESS1_RAW, limits.ADDRESS1);
    this._checkLength(errors, 'POSTAL_CODE', record.POSTAL_CODE, limits.POSTAL_CODE);
    this._checkLength(errors, 'COUNTRY', record.COUNTRY, limits.COUNTRY);
    this._checkLength(errors, 'COUNTRY_CODE', record.COUNTRY_CODE_RAW, limits.COUNTRY_CODE);
    this._checkLength(errors, 'BUSINESS_REG_NO_TIN', record.BUSINESS_REG_NO_TIN_RAW, limits.BUSINESS_REG_NO_TIN);
    this._checkLength(errors, 'EXTERNAL_BP_NUMBER', record.EXTERNAL_BP_NUMBER_RAW, limits.EXTERNAL_BP_NUMBER);
    this._checkLength(errors, 'BP_NUMBER', record.BP_NUMBER_RAW, limits.BP_NUMBER);

    // 3) TYPE validation
    const typeRaw = (record.TYPE_RAW || record.TYPE || '').toString().trim();
    if (typeRaw) {
      const lower = typeRaw.toLowerCase();
      const validMap = { domestic: 'Domestic', international: 'International', host: 'Host' };
      if (!validMap[lower]) {
        errors.push({
          code: Constants.ERROR_CODES.INVALID_TYPE,
          message: F.invalidType(typeRaw, Constants.VALID_MERCHANT_TYPES)
        });
      } else {
        record.TYPE = validMap[lower];
      }
    }

    // 4) MOBI_PORTAL_CODE validation
    const portalCodeRaw = (record.MOBI_PORTAL_CODE_RAW || record.MOBI_PORTAL_CODE || '').toString().trim();
    if (portalCodeRaw) {
      const upper = portalCodeRaw.toUpperCase();
      if (!Constants.VALID_PORTAL_CODES.includes(upper)) {
        errors.push({
          code: Constants.ERROR_CODES.INVALID_PORTAL_CODE,
          message: F.invalidPortal(portalCodeRaw, Constants.VALID_PORTAL_CODES)
        });
      } else {
        record.MOBI_PORTAL_CODE = upper;
      }
    }

    // 5) SAP_COMPANY_CODE validation
    const companyCodeRaw = (record.SAP_COMPANY_CODE_RAW || record.SAP_COMPANY_CODE || '').toString().trim();
    if (companyCodeRaw) {
      if (!/^\d+$/.test(companyCodeRaw)) {
        errors.push({
          code: Constants.ERROR_CODES.INVALID_COMPANY_CODE,
          message: F.invalidCompany(companyCodeRaw, Constants.VALID_COMPANY_CODES)
        });
      } else if (!Constants.VALID_COMPANY_CODES.includes(companyCodeRaw)) {
        errors.push({
          code: Constants.ERROR_CODES.INVALID_COMPANY_CODE,
          message: F.invalidCompany(companyCodeRaw, Constants.VALID_COMPANY_CODES)
        });
      } else {
        record.SAP_COMPANY_CODE = companyCodeRaw;
      }
    }

    // 6) COUNTRY_CODE validation
    const countryCodeRaw = (record.COUNTRY_CODE_RAW || record.COUNTRY_CODE || '').toString().trim();
    if (countryCodeRaw) {
      const upper = countryCodeRaw.toUpperCase();
      if (upper.length !== 2) {
        errors.push({
          code: Constants.ERROR_CODES.INVALID_COUNTRY_CODE,
          message: F.invalidCountry(countryCodeRaw)
        });
      } else if (!Constants.VALID_COUNTRY_CODES.includes(upper)) {
        errors.push({
          code: Constants.ERROR_CODES.INVALID_COUNTRY_CODE,
          message: F.invalidCountry(countryCodeRaw)
        });
      } else {
        record.COUNTRY_CODE = upper;
      }
    }

    // 7) BP_TAX_LONG_NUMBER / BUSINESS_REG_NO_TIN should not be in exponential notation
    const bpTaxLongNumber = (
      record.BUSINESS_REG_NO_TIN_RAW ||
      record.BP_TAX_LONG_NUMBER ||
      ''
    ).toString().trim();

    if (bpTaxLongNumber) {
      if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(bpTaxLongNumber)) {
        errors.push({
          code: Constants.ERROR_CODES.INVALID_BP_TAX_LONG_NUMBER,
          message: F.invalidBpTaxLongNumber(bpTaxLongNumber)
        });
      }
    }

    return errors;
  }

  _checkLength(errors, field, rawValue, maxLen) {
    if (rawValue === undefined || rawValue === null) return;
    const str = String(rawValue);
    if (str.trim() !== '' && str.length > maxLen) {
      errors.push({
        code: Constants.ERROR_CODES.FIELD_LENGTH_EXCEEDED,
        message: F.fieldTooLong(field, maxLen, str.length)
      });
    }
  }
}

module.exports = MasterValidator;
