
const Status = require('./StatusCodeUtil');

const masterPattern      = process.env.MASTER_FILE_PATTERN      || /^Master_\d{8}\.csv$/;
const transactionPattern = process.env.TRANSACTION_FILE_PATTERN || /^Transactions_\d{8}\.csv$/;

const MASTER_ROOT      = 'Master Data';
const TRANSACTION_ROOT = 'Transaction_Data';

const MASTER_EXPECTED_FORMAT      = 'Master_YYYYMMDD.csv (e.g. Master_20260725.csv)';
const TRANSACTION_EXPECTED_FORMAT = 'Transactions_YYYYMMDD.csv (e.g. Transactions_20260725.csv); ' +
                                    'for retries use Transactions_YYYYMMDD_ERRORS.csv or Transactions_YYYYMMDD_Updated.csv';

const VALID_COMPANY_CODES = ['1000', '2000', '3000', '4000', '5000'];
const VALID_PORTAL_CODES  = ['SG', 'MY', 'IN', 'ID', 'AE'];

const VALID_MERCHANT_TYPES       = ['Domestic', 'International', 'Host'];
const VALID_MERCHANT_TYPES_LOWER = ['domestic', 'international', 'host'];

const VALID_COUNTRY_CODES = [
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
  'CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
  'DE','DJ','DK','DM','DO','DZ',
  'EC','EE','EG','EH','ER','ES','ET',
  'FI','FJ','FK','FM','FO','FR',
  'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
  'HK','HM','HN','HR','HT','HU',
  'ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT',
  'JE','JM','JO','JP',
  'KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ',
  'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY',
  'MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
  'NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ',
  'OM',
  'PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY',
  'QA',
  'RE','RO','RS','RU','RW',
  'SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ',
  'TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ',
  'UA','UG','UM','US','UY','UZ',
  'VA','VC','VE','VG','VI','VN','VU',
  'WF','WS',
  'YE','YT',
  'ZA','ZM','ZW'
];

// Error codes used by master validator - stored as 2-digit codes in ERROR_CODE column.
const ERROR_CODES = Object.freeze({
  MANDATORY_FIELD_MISSING:     '08',
  FIELD_LENGTH_EXCEEDED:       '09',
  INVALID_TYPE:                '10',
  INVALID_PORTAL_CODE:         '11',
  INVALID_COMPANY_CODE:        '12',
  INVALID_COUNTRY_CODE:        '13',
  MISSING_BP_NUMBER:           '14',
  MISSING_EXTERNAL_BP_NUMBER:  '15',
  DUPLICATE_ID_IN_BATCH:       '07',
  DUPLICATE_BP_IN_DATABASE:    '05',
  CROSS_COMPANY_CODE_DUPLICATE:'06',
  DUPLICATE_CASE_INSENSITIVE:  '07',
  CSV_HEADER_MISMATCH:         '25',
  INVALID_BP_TAX_LONG_NUMBER: '45'
});

const FILE_STATUS = Object.freeze({
  RECEIVED:            '01',
  PROCESSING:          '02',
  COMPLETED:           '03',
  PARTIALLY_PROCESSED: '04',
  FAILED:              '05'
});

const ROW_STATUS = Object.freeze({
  VALID:   '01',
  INVALID: '02',
  POSTED:  '03'
});

const ACTIVE_FLAG = process.env.ACTIVE_FLAG || 'X';
const ACTIVE_STATUS_CODE = '01';   // Master ACTIVE code

module.exports = Object.freeze({
  BATCH_SIZE: Number(process.env.BATCH_SIZE || 2000),
  ACTIVE_FLAG,
  ACTIVE_STATUS_CODE,
  VALID_COMPANY_CODES,
  VALID_PORTAL_CODES,
  VALID_MERCHANT_TYPES,
  VALID_MERCHANT_TYPES_LOWER,
  VALID_COUNTRY_CODES,
  MASTER_EXPECTED_FORMAT,
  TRANSACTION_EXPECTED_FORMAT,
  ERROR_CODES,
  FILE_STATUS,
  ROW_STATUS,

  SFTP: {
    MASTER: {
      ROOT_PATH:       MASTER_ROOT,
      FILEIN_PATH:     `${MASTER_ROOT}/FILE_IN`,
      PROCESSING_PATH: `${MASTER_ROOT}/PROCESSING`,
      ERROR_PATH:      `${MASTER_ROOT}/ERROR`,
      PROCESSED_PATH:  `${MASTER_ROOT}/FILE_OUT`
    },
    TRANSACTION: {
      ROOT_PATH:       TRANSACTION_ROOT,
      FILEIN_PATH:     `${TRANSACTION_ROOT}/FILE_IN`,
      PROCESSING_PATH: `${TRANSACTION_ROOT}/PROCESSING`,
      ERROR_PATH:      `${TRANSACTION_ROOT}/ERROR`,
      PROCESSED_PATH:  `${TRANSACTION_ROOT}/FILE_OUT`
    }
  },

  FILES: {
    MASTER_REGEX:      (masterPattern instanceof RegExp)      ? masterPattern      : new RegExp(masterPattern),
    TRANSACTION_REGEX: (transactionPattern instanceof RegExp) ? transactionPattern : new RegExp(transactionPattern)
  },

  SYSTEM_USERS: { DEFAULT: 'SYSTEM_SFTP', SFTP: 'SYSTEM_SFTP' },

  MASTER_HEADERS: {
    mobi_portal_code:   ['mobi_portal_code'],
    sap_company_code:   ['sap_company_code'],
    id:                 ['id', 'merchant_id'],
    type:               ['type', 'merchant_type'],
    address1:           ['address1'],
    postal_code:        ['postal_code'],
    country:            ['country'],
    country_code:       ['country_code', 'country_code_in_sap'],
    business_reg_no_tin:['business_reg_no_tin'],
    merchant_name:      ['name', 'master_name'],
    bp_number:          ['bp_number'],
    host_name:          ['host_name'],
    external_bp_number: ['external_bp_number']
  },

  MASTER_REQUIRED_HEADERS: [
    'mobi_portal_code', 'sap_company_code', 'id', 'type', 'address1',
    'country', 'country_code', 'business_reg_no_tin', 'name'
  ],

  FIELD_LIMITS: {
    ID: 20, MOBI_PORTAL_CODE: 2, SAP_COMPANY_CODE: 4, TYPE: 20, ADDRESS1: 60,
    POSTAL_CODE: 10, COUNTRY: 80, COUNTRY_CODE: 2, BUSINESS_REG_NO_TIN: 50,
    MASTER_NAME: 40, EXTERNAL_BP_NUMBER: 20, BP_NUMBER: 10, CONSOLIDATED: 4, NAME: 40,
    STREET: 60, COUNTRY_REGION: 10, BP_TAX_LONG_NUMBER: 50, LANGUAGE: 2,
    RECONCILIATION_ACCOUNT: 10, CHECK_DUPLICATE_INVOICE_IND: 1, PURCHASING_ORGANIZATION: 4,
    GR_BASED_INVOICE_IND: 1, BUSINESS_PARTNER_CATEGORY: 1, BUSINESS_PARTNER_ROLE: 20,
    SALES_ORGANIZATION: 4, ACTIVE_FLAG: 1
  },

  
  MANDATORY_FIELDS: ['ID', 'MOBI_PORTAL_CODE', 'SAP_COMPANY_CODE', 'TYPE', 'COUNTRY_CODE', 'MASTER_NAME'],

  DUPLICATE_CHECK: {
    WITHIN_BATCH:       true,
    AGAINST_DATABASE:   true,
    CROSS_COMPANY_CODE: true,
    CASE_INSENSITIVE:   true
  }
});
