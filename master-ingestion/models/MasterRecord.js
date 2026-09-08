const Constants = require('../utils/Constants');

function pick(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value);
  }
  return '';
}

class MasterRecord {

  static fromCsvRow(row, rowNumber) {
    const rawId = pick(row, ['merchant_id', 'id']);
    const id = rawId.substring(0, 20);
    const mobiPortalCodeRaw = pick(row, ['mobi_portal_code']);
    const sapCompanyCodeRaw = pick(row, ['sap_company_code']);
    const typeRaw = pick(row, ['merchant_type', 'type']);
    const countryCodeRaw = pick(row, ['country_code_in_sap', 'country_code']);
    const masterNameRaw = pick(row, ['name', 'master_name']);
    const address1Raw = pick(row, ['address1']);
    const businessRegNoTinRaw = pick(row, ['business_reg_no_tin']);
    const externalBpRaw = pick(row, ['external_bp_number', 'id']);
    const bpNumberRaw = pick(row, ['bp_number']);
    const hostName = pick(row, ['host_name']);

    return {
      ID: id,
      MOBI_PORTAL_CODE: mobiPortalCodeRaw.substring(0, 2),
      MOBI_PORTAL_CODE_RAW: mobiPortalCodeRaw,
      SAP_COMPANY_CODE: sapCompanyCodeRaw.substring(0, 4),
      SAP_COMPANY_CODE_RAW: sapCompanyCodeRaw,
      TYPE: typeRaw.substring(0, 20),
      TYPE_RAW: typeRaw,
      ADDRESS1: address1Raw.substring(0, 255),
      ADDRESS1_RAW: address1Raw,
      POSTAL_CODE: pick(row, ['postal_code']).substring(0, 10) || ' ',
      COUNTRY: pick(row, ['country']).substring(0, 80),
      COUNTRY_CODE: countryCodeRaw.substring(0, 2),
      COUNTRY_CODE_RAW: countryCodeRaw,
      BUSINESS_REG_NO_TIN: businessRegNoTinRaw.substring(0, 50),
      BUSINESS_REG_NO_TIN_RAW: businessRegNoTinRaw,
      MASTER_NAME: masterNameRaw.substring(0, 40),
      MASTER_NAME_RAW: masterNameRaw,
      EXTERNAL_BP_NUMBER: externalBpRaw.substring(0, 20),
      EXTERNAL_BP_NUMBER_RAW: externalBpRaw,
      BP_NUMBER: bpNumberRaw.substring(0, 10) || ' ',
      BP_NUMBER_RAW: bpNumberRaw,
      HOST_NAME: hostName.substring(0, 15),
      CONSOLIDATED: ' ',
      NAME: masterNameRaw.substring(0, 40) || ' ',
      STREET: address1Raw.substring(0, 60) || ' ',
      COUNTRY_REGION: countryCodeRaw.substring(0, 2) || ' ',
      BP_TAX_LONG_NUMBER: businessRegNoTinRaw.substring(0, 50) || ' ',
      LANGUAGE: 'EN',
      RECONCILIATION_ACCOUNT: ' ',
      CHECK_DUPLICATE_INVOICE_IND: 'X',
      PURCHASING_ORGANIZATION: sapCompanyCodeRaw.substring(0, 4) || ' ',
      GR_BASED_INVOICE_IND: ' ',
      BUSINESS_PARTNER_CATEGORY: ' ',
      BUSINESS_PARTNER_ROLE: ' ',
      SALES_ORGANIZATION: sapCompanyCodeRaw.substring(0, 4) || ' ',
      ACTIVE_FLAG: Constants.ACTIVE_FLAG,
      POSTING_STATUS: '01',
      STATUS_CODE: '006', // <-- Set to '006' ('SUCCESS') so CPI picks it up!
      // internal fields used for error reporting
      _rowNumber: rowNumber,
      _rawId: rawId
    };
  }
}

module.exports = MasterRecord;
