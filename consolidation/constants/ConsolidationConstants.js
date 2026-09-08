'use strict';

/**
 * Consolidation constants.
 *
 * CONSOLIDATIONHEADER and CONSOLIDATIONLINEITEM use a single STATUS_CODE :
 * String(3) that holds the global 3-digit status code (from
 * StatusCodeUtil.STATUS). Error detail text is written to AUDIT.STATUS_MESSAGE.
 *
 * Key lifecycle codes for consolidation (all 3-digit, from MOBI_DB_STATUS):
 *   041 TRANSACTION_SUCCESS        – ALSO acts as "pending consolidation"
 *   053 CONSOLIDATION_PENDING      – document built, waiting for SAP
 *   060 POSTING_PENDING            – intermediate state (kept for compat)
 *   061 POSTED                     – SAP posting success
 *   062 POSTING_FAILED             – SAP posting failure (retryable)
 *   055 CONSOLIDATION_FAILED       – build/validation failure before posting
 *   056 GL_ACCOUNT_MISSING         – recoverable, transaction blocked
 *   057 MERCHANT_BP_MISSING        – recoverable, transaction blocked
 *   058 HOST_BP_MISSING            – recoverable, transaction blocked
 *   059 BP_MASTER_MISSING          – generic recoverable BP error
 */

const StatusCodeUtil = require('../utils/StatusCodeUtil');

const SC_041 = StatusCodeUtil.toCode('TRANSACTION_SUCCESS');
const SC_053 = StatusCodeUtil.toCode('CONSOLIDATION_PENDING');
const SC_055 = StatusCodeUtil.toCode('CONSOLIDATION_FAILED');
const SC_056 = StatusCodeUtil.toCode('GL_ACCOUNT_MISSING');
const SC_057 = StatusCodeUtil.toCode('MERCHANT_BP_MISSING');
const SC_058 = StatusCodeUtil.toCode('HOST_BP_MISSING');
const SC_059 = StatusCodeUtil.toCode('BP_MASTER_MISSING');
const SC_060 = StatusCodeUtil.toCode('POSTING_PENDING');
const SC_061 = StatusCodeUtil.toCode('POSTED');
const SC_062 = StatusCodeUtil.toCode('POSTING_FAILED');

module.exports = Object.freeze({
  SYSTEM_USER: 'SYSTEM_CONSOLIDATION',

  SYSTEM_USERS: {
    PAYIN: 'SYSTEM_PAYIN',
    PAYOUT: 'SYSTEM_PAYOUT',
    DOMESTIC_SETTLEMENT: 'SYSTEM_DS',
    DEFAULT: 'SYSTEM_CONSOLIDATION'
  },

  // -----------------------------------------------------------------
  // SFTP location for consolidation error reports (Requirement #5).
  // Consolidation GL/BP errors are written as
  // Transactions_YYYYMMDD_Consolidation.csv into the shared ERROR folder.
  // -----------------------------------------------------------------
  SFTP: {
    CONSOL_ERROR_PATH: 'Transaction_Data/ERROR'
  },

  // -----------------------------------------------------------------
  // HEADER / LINE_ITEM 3-digit STATUS_CODE values
  // -----------------------------------------------------------------
  POSTING_STATUS: {
    CONSOLIDATION_PENDING: SC_053,
    POSTING_PENDING: SC_060,
    POSTED: SC_061,
    POSTING_FAILED: SC_062,
    FAILED: SC_062
  },

  ERROR_CODES: {
    MISSING_GL_ACCOUNT: 'GL_ACCOUNT_MISSING',
    MISSING_BP_MASTER: 'BP_MASTER_MISSING',
    MISSING_MERCHANT_BP: 'MERCHANT_BP_MISSING',
    MISSING_HOST_CUSTOMER_BP: 'HOST_BP_MISSING',
    CONSOLIDATION_BUILD_FAILED: 'CONSOLIDATION_FAILED',
    POSTING_FAILED: 'POSTING_FAILED'
  },

  ERROR_TO_STATUS_CODE: Object.freeze({
    GL_ACCOUNT_MISSING: SC_056,
    BP_MASTER_MISSING: SC_059,
    MERCHANT_BP_MISSING: SC_057,
    HOST_BP_MISSING: SC_058,
    CONSOLIDATION_FAILED: SC_055,
    POSTING_FAILED: SC_062
  }),

  DEBIT_CREDIT: {
    DEBIT: 'S',
    CREDIT: 'H'
  },

  PAYMENT_CODES: {
    UNKNOWN: 0,
    PAYIN: 1,
    PAYOUT: 2,
    DOMESTIC_SETTLEMENT: 3,
    NORMAL: 4
  },

  GROUP_MODE: {
    DAILY: 'DAILY',
    PER_TRANSACTION: 'PER_TRANSACTION'
  },

  DB_CHUNK_SIZE: Number(process.env.DB_CHUNK_SIZE || 2000),
  DB_SMALL_CHUNK_SIZE: Number(process.env.DB_SMALL_CHUNK || 500),

  TXN_STATUS: {
    SUCCESS: SC_041,
    FAILED: StatusCodeUtil.toCode('TRANSACTION_FAILED'),
    PENDING: StatusCodeUtil.toCode('TRANSACTION_PENDING'),
    RETURN: StatusCodeUtil.toCode('TRANSACTION_RETURN')
  },

  CONSOL_STATUS: {
    SUCCESS_TXN_PENDING: SC_041,
    PENDING: SC_053,
    POSTING_PENDING: SC_060,
    POSTED: SC_061,
    GL_ACCOUNT_MISSING: SC_056,
    BP_MASTER_MISSING: SC_059,
    MERCHANT_BP_MISSING: SC_057,
    HOST_CUSTOMER_BP_MISSING: SC_058,
    CONSOLIDATION_FAILED: SC_055,
    POSTING_FAILED: SC_062
  },

  /**
   * The canonical set of TRANSACTION.STATUS_CODE values that mean "pick this
   * row up for consolidation". Includes 041/053 (ready) plus all retryable
   * error codes (055/056/057/058/059/062).
   */
  PENDING_CONSOL_STATUSES: Object.freeze([
    SC_041, SC_053,
    SC_056, SC_057, SC_058, SC_059,
    SC_055
  ]),

  AUDIT: {
    PROCESS_NAME: 'CONSOLIDATION',
    PROCESS_TYPES: {
      RUN: 'RUN',
      TRANSACTION: 'TRANSACTION',
      DOCUMENT: 'DOCUMENT',
      POSTING: 'POSTING',
      PATCH: 'PATCH'
    }
  }
});
