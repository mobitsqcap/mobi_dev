'use strict';

const cds = require('@sap/cds');

const EntityNames = require('../constants/EntityNames');
const ScenarioConfig = require('../config/ScenarioConfig');
const Constants = require('../constants/ConsolidationConstants');

const FIELDS_BY_SCENARIO = Object.freeze({
  PAYIN: [
    'CONSOL_REF_ID', 'DOC_REF_ITEM', 'SAP_REF_DOCUMENT', 'COMPANY_CODE',
    'MOBI_PORTAL_CODE', 'PAYMENT_TYPE', 'PAYMENT_SUB_TYPE', 'MERCHANT_ID',
    'SAP_SUPPLIER_NUMBER', 'SAP_CUSTOMER_NUMBER', 'POSTING_DATE', 'DOCUMENT_DATE',
    'BASELINE_DATE', 'HOST_NAME', 'CURRENCY', 'HOST_MDR_AMOUNT', 'MDR_REVENUE',
    'AR_PAYIN', 'AP_PAYIN', 'GL_ACCOUNT', 'DEBIT_CREDIT_INDICATOR', 'COST_CENTER',
    'PROFIT_CENTER', 'DOCUMENT_TYPE', 'STATUS_CODE',
    'POST_DATE', 'HTTP_STATUS', 'RETRY_COUNT',
    'CREATED_BY', 'CREATED_TIMESTAMP', 'CHANGED_BY', 'CHANGED_TIMESTAMP'
  ],
  PAYOUT: [
    'CONSOL_REF_ID', 'DOC_REF_ITEM', 'SAP_REF_DOCUMENT', 'COMPANY_CODE',
    'MOBI_PORTAL_CODE', 'PAYMENT_TYPE', 'PAYMENT_SUB_TYPE', 'MERCHANT_ID',
    'SAP_SUPPLIER_NUMBER', 'SAP_CUSTOMER_NUMBER', 'POSTING_DATE', 'DOCUMENT_DATE',
    'BASELINE_DATE', 'HOST_NAME', 'CURRENCY', 'HOST_MDR_AMOUNT', 'HOST_FEE_PAYABLE',
    'MDR_REVENUE', 'AP_PAYOUT', 'TRANSACTION_AMOUNT', 'GL_ACCOUNT',
    'DEBIT_CREDIT_INDICATOR', 'COST_CENTER', 'PROFIT_CENTER', 'DOCUMENT_TYPE',
    'STATUS_CODE', 'POST_DATE', 'HTTP_STATUS', 'RETRY_COUNT',
    'CREATED_BY', 'CREATED_TIMESTAMP', 'CHANGED_BY', 'CHANGED_TIMESTAMP'
  ],
  DOMESTIC_SETTLEMENT: [
  'CONSOL_REF_ID',
  'DOC_REF_ITEM',
  'SAP_REF_DOCUMENT',
  'COMPANY_CODE',
  'MOBI_PORTAL_CODE',
  'PAYMENT_TYPE',
  'PAYMENT_SUB_TYPE',
  'MERCHANT_ID',
  'SAP_SUPPLIER_NUMBER',
  'SAP_CUSTOMER_NUMBER',
  'POSTING_DATE',
  'DOCUMENT_DATE',
  'BASELINE_DATE',
  'HOST_NAME',
  'CURRENCY',
  'HOST_MDR_AMOUNT',
  'HOST_FEE_PAYABLE',
  'AP_PAYOUT',
  'TRANSACTION_AMOUNT',
  'GL_ACCOUNT',
  'DEBIT_CREDIT_INDICATOR',
  'COST_CENTER',
  'PROFIT_CENTER',
  'DOCUMENT_TYPE',
  'STATUS_CODE',
  'POST_DATE',
  'HTTP_STATUS',
  'RETRY_COUNT',
  'CREATED_BY',
  'CREATED_TIMESTAMP',
  'CHANGED_BY',
  'CHANGED_TIMESTAMP'
]
});

const SC_POSTED = Constants.POSTING_STATUS.POSTED;
const SC_POSTING_FAILED = Constants.POSTING_STATUS.POSTING_FAILED;
const SC_POSTING_PENDING = Constants.POSTING_STATUS.POSTING_PENDING;

function createLineItemsReadHandler(scenarioCode) {
  const allowedFields = FIELDS_BY_SCENARIO[scenarioCode];
  if (!allowedFields) throw new Error(`Unsupported line item read scenario ${scenarioCode}`);

  const scenario = ScenarioConfig[scenarioCode];
  const scenarioFilter = scenarioWhere(scenarioCode, scenario);

  return async function lineItemsReadHandler(req) {
    const db = await cds.connect.to('db');
    const sourceSelect = req.query?.SELECT || {};

    const query = {
      SELECT: {
        from: { ref: [EntityNames.CONSOLIDATION_LINE_ITEM] },
        columns: buildColumns(sourceSelect.columns, allowedFields),
        where: combineWhere(scenarioFilter, transformExpression(sourceSelect.where)),
        orderBy: transformExpression(sourceSelect.orderBy),
        limit: sourceSelect.limit,
        one: sourceSelect.one
      }
    };

    cleanupSelect(query.SELECT);

    const rows = await db.run(query);

    if (Array.isArray(rows)) return rows.map(addConsolStatus);
    return addConsolStatus(rows);
  };
}

// -----------------------------------------------------------------------------
// Column handling
// -----------------------------------------------------------------------------

function buildColumns(requestedColumns, allowedFields) {
  if (isCountColumns(requestedColumns)) return requestedColumns;

  if (!requestedColumns?.length || requestedColumns.some((c) => c === '*' || c?.ref?.[0] === '*')) {
    return allowedFields.map(toBaseColumn);
  }

  const mapped = requestedColumns
    .filter((c) => !c.ref || allowedFields.includes(c.ref[0]) || (c.ref?.[0] === 'CONSOL_STATUS'))
    .map(toBaseColumn);

  return mapped.length ? mapped : allowedFields.map(toBaseColumn);
}

function isCountColumns(columns = []) {
  return columns.some((c) => c.func === 'count' || c.as === '$count');
}

function toBaseColumn(columnOrField) {
  const field = typeof columnOrField === 'string' ? columnOrField : columnOrField?.ref?.[0];

  if (field === 'CONSOL_STATUS') return { ref: ['STATUS_CODE'], as: 'CONSOL_STATUS' };
  return typeof columnOrField === 'string' ? { ref: [field] } : columnOrField;
}

// -----------------------------------------------------------------------------
// Expression / WHERE helpers
// -----------------------------------------------------------------------------

function transformExpression(value) {
  if (!value) return value;
  if (Array.isArray(value)) return value.map(transformExpression);
  if (value.ref?.[0] === 'CONSOL_STATUS' || value.ref?.[0] === 'POSTING_STATUS') {
    return { ...value, ref: ['STATUS_CODE', ...value.ref.slice(1)] };
  }
  if (typeof value === 'object') {
    const clone = { ...value };
    for (const [k, v] of Object.entries(clone)) clone[k] = transformExpression(v);
    return clone;
  }
  return value;
}

function combineWhere(left, right) {
  if (!left?.length) return right;
  if (!right?.length) return left;
  return ['(', ...left, ')', 'and', '(', ...right, ')'];
}

function scenarioWhere(scenarioCode, scenario) {
  const clauses = [];

  if (scenarioCode === 'PAYIN') {
    clauses.push(
      '(', { ref: ['PAYMENT_TYPE'] }, '=', { val: 'PAYINS' },
      'or', { ref: ['PAYMENT_TYPE'] }, '=', { val: 'PAYIN' }, ')'
    );
  } else if (scenarioCode === 'PAYOUT') {
    clauses.push(
      { ref: ['PAYMENT_TYPE'] }, '=', { val: 'PAYOUT' },
      'and',
      { ref: ['PAYMENT_SUB_TYPE'] }, '<>', { val: 'DOMESTIC SETTLEMENT' }
    );
  } else if (scenarioCode === 'DOMESTIC_SETTLEMENT') {
    clauses.push(
      { ref: ['PAYMENT_TYPE'] }, '=', { val: 'PAYOUT' },
      'and',
      { ref: ['PAYMENT_SUB_TYPE'] }, '=', { val: 'DOMESTIC SETTLEMENT' }
    );
  }

  const companies = scenario?.allowedCompanyCodes || [];
  if (companies.length > 0) {
    clauses.push('and',
      { ref: ['COMPANY_CODE'] }, 'in',
      { list: companies.map((cc) => ({ val: cc })) }
    );
  }

  const refToken = scenario?.refToken;
  if (refToken) {
    const patterns = [
      ...companies.map((cc) => `${cc}${refToken}%`),
      `${refToken}%`
    ];
    const likeChain = ['('];
    patterns.forEach((pat, idx) => {
      if (idx > 0) likeChain.push('or');
      likeChain.push({ ref: ['CONSOL_REF_ID'] }, 'like', { val: pat });
    });
    likeChain.push(')');
    clauses.push('and', ...likeChain);
  }

  return clauses;
}

function cleanupSelect(select) {
  Object.keys(select).forEach((k) => {
    if (select[k] === undefined || select[k] === null) delete select[k];
  });
}

function addConsolStatus(row) {
  if (!row) return row;

  if (row.STATUS_CODE !== undefined && row.CONSOL_STATUS === undefined) {
    row.CONSOL_STATUS = row.STATUS_CODE;
  }

  switch (String(row.STATUS_CODE)) {
    case SC_POSTED: row.STATUS_TEXT = 'POSTED'; break;
    case SC_POSTING_FAILED: row.STATUS_TEXT = 'POSTING_FAILED'; break;
    case SC_POSTING_PENDING: row.STATUS_TEXT = 'POSTING_PENDING'; break;
    default: row.STATUS_TEXT = 'PENDING';
  }

  row.CHANGED_BY = null;
  row.CHANGED_TIMESTAMP = null;
  return row;
}

module.exports = createLineItemsReadHandler;
