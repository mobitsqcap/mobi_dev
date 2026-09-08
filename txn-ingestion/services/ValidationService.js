'use strict';

const Constants = require('../utils/Constants');
const StatusCodeUtil = require('../utils/StatusCodeUtil');

const key = (...values) => values.map((value) => String(value || '').trim().toUpperCase()).join('|');
const isHost = (master) => String(master.TYPE || '').trim().toUpperCase() === 'HOST';

class ValidationService {
  constructor({ technicalValidator, businessValidator, currencyValidator, amountValidator, masterRepository, duplicateValidator }) {
    Object.assign(this, {
      technicalValidator,
      businessValidator,
      currencyValidator,
      amountValidator,
      masterRepository,
      duplicateValidator
    });
  }

  async validateBatch(records, context) {
    const shared = context || this.createContext();

    if (!shared.masterIndex) {
      shared.masterIndex = this._buildMasterIndex(await this.masterRepository.findActiveForValidation());
    }

    const dbDuplicates = this.duplicateValidator
      ? await this.duplicateValidator.prepare(records)
      : { existingMobi: new Set(), hostDays: new Set() };

    const validated = [];

    for (const record of records) {
      const errors = [];

      for (const validator of [
        this.technicalValidator,
        this.businessValidator,
        this.currencyValidator,
        this.amountValidator
      ]) {
        if (!validator) continue;
        const result = await validator.validate(record);
        if (!result.valid) errors.push(...this._errorsOf(result));
      }

      this._validateInFileDuplicates(record, shared, errors);

      if (this.duplicateValidator) {
        const duplicateResult = this.duplicateValidator.validate(record, dbDuplicates);
        if (!duplicateResult.valid) errors.push(...this._errorsOf(duplicateResult));
      }

      this._validateMaster(record, shared.masterIndex, errors);

      validated.push(errors.length ? this._markInvalid(record, errors) : this._markValid(record));
    }

    return validated;
  }

  createContext() {
    return {
      mobiReferencesSeen: new Set(),
      // hostReferencesSeen REMOVED - HOST_REFERENCE_ID has no validation
      masterIndex: null
    };
  }

  _validateInFileDuplicates(record, context, errors) {
    const mobiReference = String(record.MOBI_REFERENCE_ID || '').trim();
    if (mobiReference) {
      if (context.mobiReferencesSeen.has(mobiReference)) {
        errors.push({
          code: StatusCodeUtil.toCode('DUPLICATE_MOBI_REFERENCE'),
          message: StatusCodeUtil.FRIENDLY.duplicateMobiRef(mobiReference)
        });
      }
      context.mobiReferencesSeen.add(mobiReference);
    }

    // HOST_REFERENCE_ID: NO VALIDATION
    // - duplicates within file are allowed
    // - duplicates per day are allowed
    // - empty values are allowed
    // Previously checked DUPLICATE_HOST_REFERENCE here - removed
  }

  _buildMasterIndex(masters) {
    const portalCodes = new Set();
    const portalCompanyKeys = new Set();
    const merchants = new Map();
    const hosts = new Set();

    for (const master of masters || []) {
      portalCodes.add(key(master.MOBI_PORTAL_CODE));
      portalCompanyKeys.add(key(master.MOBI_PORTAL_CODE, master.SAP_COMPANY_CODE));
      const masterKey = key(master.MOBI_PORTAL_CODE, master.SAP_COMPANY_CODE, master.ID);
      if (isHost(master)) hosts.add(masterKey);
      else merchants.set(masterKey, master);
    }

    return { portalCodes, portalCompanyKeys, merchants, hosts };
  }

  _validateMaster(record, index, errors) {
    const portalKey = key(record.MOBI_PORTAL_CODE);
    const companyKey = key(record.MOBI_PORTAL_CODE, record.COMPANY_CODE);
    const merchantKey = key(record.MOBI_PORTAL_CODE, record.COMPANY_CODE, record.MERCHANT_ID);
    const hostKey = key(record.MOBI_PORTAL_CODE, record.COMPANY_CODE, record.HOST_NAME);

    // Requirement change: every missing master-data element produces the unified
    // NO_MASTER_DATA_FOUND code with "No master data found "{value}"". All such
    // issues are collected (no early return) so the full set is concatenated into
    // one canonical error detail for the text file and the audit.
    const noMasterCode = StatusCodeUtil.toCode('NO_MASTER_DATA_FOUND');

    if (!index.portalCodes.has(portalKey)) {
      errors.push({
        code: noMasterCode,
        message: StatusCodeUtil.FRIENDLY.noMasterDataFound(record.MOBI_PORTAL_CODE)
      });
    }

    if (!index.portalCompanyKeys.has(companyKey)) {
      errors.push({
        code: noMasterCode,
        message: StatusCodeUtil.FRIENDLY.noMasterDataFound(record.COMPANY_CODE)
      });
    }

    const merchant = index.merchants.get(merchantKey);
    if (!merchant) {
      errors.push({
        code: noMasterCode,
        message: StatusCodeUtil.FRIENDLY.noMasterDataFound(record.MERCHANT_ID)
      });
    } else {
      record.COUNTRY_CODE = merchant.COUNTRY_CODE || '';
    }

    if (!index.hosts.has(hostKey)) {
      errors.push({
        code: noMasterCode,
        message: StatusCodeUtil.FRIENDLY.noMasterDataFound(record.HOST_NAME)
      });
    }
  }

  _errorsOf(result) {
    if (result.errors?.length) return result.errors;
    return [{ code: result.code, message: result.message }];
  }

  _markValid(record) {
    record.ROW_STATUS = Constants.ROW_STATUS.VALID;
    record.STATUS_CODE = StatusCodeUtil.toCode('TRANSACTION_SUCCESS');
    record.STATUS_MESSAGE = '';
    return record;
  }

  _markInvalid(record, errors) {
    record.ROW_STATUS = Constants.ROW_STATUS.INVALID;
    record.STATUS_CODE = StatusCodeUtil.joinErrorCodes(errors);
    // STATUS_MESSAGE holds the canonical, fully-concatenated detail — identical
    // to what the error text file and the audit will display for this record.
    record.STATUS_MESSAGE = StatusCodeUtil.concatErrorDetail(errors).slice(0, 500);
    record._VALIDATION_ERRORS = errors;
    return record;
  }
}

module.exports = ValidationService;
