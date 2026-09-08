'use strict';

const cds = require('@sap/cds');
const StatusCodeUtil = require('../consolidation/utils/StatusCodeUtil');

const createScenarioHandler = require('../consolidation/service-handlers/createScenarioHandler');
const createLineItemPatchHandler = require('../consolidation/service-handlers/createLineItemPatchHandler');
const createLineItemsReadHandler = require('../consolidation/service-handlers/createLineItemsReadHandler');
const createBatchPostingResultHandler = require('../consolidation/service-handlers/createBatchPostingResultHandler');

module.exports = cds.service.impl(async function () {
  await StatusCodeUtil.ensureStatusTable();

  this.on('READ', 'LineItems', createLineItemsReadHandler('PAYOUT'));
  this.on('UPDATE', 'LineItems', createLineItemPatchHandler('PAYOUT'));
  this.on('runPayoutConsolidation', createScenarioHandler('PAYOUT'));
  this.on('updateBatchPostingResults', createBatchPostingResultHandler('PAYOUT'));

  this.before(['CREATE', 'DELETE'], 'LineItems', (req) => {
    req.reject(405, 'Only READ and PATCH are allowed for Payout LineItems');
  });
});
