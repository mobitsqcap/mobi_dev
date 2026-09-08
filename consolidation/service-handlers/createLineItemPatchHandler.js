'use strict';


const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;

const EntityNames = require('../constants/EntityNames');
const Constants = require('../constants/ConsolidationConstants');
const AuditRepository = require('../repositories/AuditRepository');

const PATCHABLE_FIELDS = Object.freeze([
  'GL_ACCOUNT', 'COST_CENTER', 'PROFIT_CENTER', 'DEBIT_CREDIT_INDICATOR',
  'SAP_SUPPLIER_NUMBER', 'SAP_CUSTOMER_NUMBER',
  'HOST_MDR_AMOUNT', 'HOST_FEE_PAYABLE', 'MDR_REVENUE',
  'AR_PAYIN', 'AP_PAYIN', 'AP_PAYOUT', 'TRANSACTION_AMOUNT'
]);

const SC_POSTED = Constants.POSTING_STATUS.POSTED;

module.exports = function createLineItemPatchHandler(scenarioCode) {
  const auditRepo = new AuditRepository({ softFail: true });

  return async function lineItemPatchHandler(req) {
    const key = (req.params && req.params[0]) || req.data || {};
    const consolRefId = key.CONSOL_REF_ID ?? key.consolRefId;
    const docRefItem = key.DOC_REF_ITEM ?? key.docRefItem;

    if (!consolRefId) { req.error(400, 'CONSOL_REF_ID is required.'); return; }
    if (docRefItem === undefined || docRefItem === null) {
      req.error(400, 'DOC_REF_ITEM is required.'); return;
    }

    const db = await cds.connect.to('db');
    const actor = req?.user?.id || req?.user?.attr?.user_name || 'SYSTEM';

    const existing = await db.run(
      SELECT.one.from(EntityNames.CONSOLIDATION_LINE_ITEM)
        .columns('CONSOL_REF_ID', 'DOC_REF_ITEM', 'STATUS_CODE', 'DOCUMENT_TYPE')
        .where({ CONSOL_REF_ID: consolRefId, DOC_REF_ITEM: docRefItem })
    );

    if (!existing) { req.error(404, `Line item ${consolRefId}/${docRefItem} not found.`); return; }

    if (String(existing.STATUS_CODE) === SC_POSTED) {
      req.error(409, 'Line item belongs to a POSTED document and cannot be modified.');
      return;
    }

    const payload = { CHANGED_BY: null, CHANGED_TIMESTAMP: null };
    let patched = false;
    const changedFields = {};

    for (const f of PATCHABLE_FIELDS) {
      if (req.data[f] !== undefined && req.data[f] !== null) {
        payload[f] = req.data[f];
        changedFields[f] = req.data[f];
        patched = true;
      }
    }

    if (!patched) {
      req.error(400, `No patchable fields supplied. Allowed: ${PATCHABLE_FIELDS.join(', ')}.`);
      return;
    }

    payload.CHANGED_BY = actor;
    payload.CHANGED_TIMESTAMP = new Date().toISOString();

    await db.run(
      UPDATE(EntityNames.CONSOLIDATION_LINE_ITEM)
        .set(payload)
        .where({ CONSOL_REF_ID: consolRefId, DOC_REF_ITEM: docRefItem })
    );

    await auditRepo.updatePatchAudit({
      auditId: null,
      consolRefId,
      docRefItem,
      changedFields,
      changedBy: actor
    });

    return db.run(
      SELECT.one.from(EntityNames.CONSOLIDATION_LINE_ITEM)
        .where({ CONSOL_REF_ID: consolRefId, DOC_REF_ITEM: docRefItem })
    );
  };
};
