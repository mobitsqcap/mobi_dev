'use strict';


const ScenarioConfig = require('../config/ScenarioConfig');
const ConsolidationRepository = require('../repositories/ConsolidationRepository');
const TransactionRepository = require('../repositories/TransactionRepository');
const AuditRepository = require('../repositories/AuditRepository');
const Constants = require('../constants/ConsolidationConstants');

const SC_POSTING_PENDING = Constants.POSTING_STATUS.POSTING_PENDING; // 060
const SC_POSTED = Constants.POSTING_STATUS.POSTED;                   // 061
const SC_POSTING_FAILED = Constants.POSTING_STATUS.POSTING_FAILED;   // 062
const VALID_STATUS_CODES = new Set([SC_POSTING_PENDING, SC_POSTED, SC_POSTING_FAILED]);

// Backward-compatible alias: postingStatus text / legacy 2-digit -> 3-digit code.
function resolveStatusCode(item) {
  const direct = String(item.statusCode || item.STATUS_CODE || '').trim();
  if (direct) return direct;

  const ps = String(item.postingStatus || item.POSTING_STATUS || '').trim().toUpperCase();
  if (['POSTED', 'SUCCESS', 'S', '03'].includes(ps)) return SC_POSTED;
  if (['POSTING_FAILED', 'FAILED', 'ERROR', 'E', '07'].includes(ps)) return SC_POSTING_FAILED;
  if (['POSTING_PENDING', 'PENDING', '02'].includes(ps)) return SC_POSTING_PENDING;
  return '';
}

module.exports = function createBatchPostingResultHandler(scenarioCode) {
  const scenario = ScenarioConfig[scenarioCode];
  if (!scenario) throw new Error(`Unknown consolidation scenario: ${scenarioCode}`);

  const consolidationRepo = new ConsolidationRepository();
  const transactionRepo = new TransactionRepository();
  const auditRepo = new AuditRepository({ softFail: true });

  return async function batchPostingResultHandler(req) {
    const actor = req?.user?.id || req?.user?.attr?.user_name || scenario.systemUser;
    const items = Array.isArray(req.data?.items)
      ? req.data.items
      : Array.isArray(req.data) ? req.data : [];

    if (!items.length) {
      req.error(400, 'items (array of posting results) is required.');
      return;
    }

    const responses = [];

    for (const raw of items) {
      const item = raw || {};

      const consolRefId = String(item.consolRefId || item.CONSOL_REF_ID || '').trim();
      const sapRefDocument = String(item.sapRefDocument || item.SAP_REF_DOCUMENT || item.refdoc || '').trim();
      const requestedCode = resolveStatusCode(item);
      const httpStatus = item.httpStatus ?? item.HTTP_STATUS ?? null;
      const errorDetail = String(item.errorDetail || item.ERROR_DETAIL || '');

      const response = {
        consolRefId,
        sapRefDocument,
        statusCode: requestedCode,
        httpStatus,
        errorDetail,
        message: ''
      };

      if (!consolRefId) {
        responses.push({ ...response, statusCode: '', message: 'consolRefId is required.' });
        continue;
      }

      if (!VALID_STATUS_CODES.has(requestedCode)) {
        responses.push({
          ...response,
          statusCode: '',
          message: `Invalid statusCode "${requestedCode}". Expected 060 (POSTING_PENDING), 061 (POSTED) or 062 (POSTING_FAILED).`
        });
        continue;
      }

      if (requestedCode === SC_POSTED && !sapRefDocument) {
        responses.push({
          ...response,
          message: 'sapRefDocument is required when statusCode is 061 (POSTED).'
        });
        continue;
      }

      try {
        const result = await consolidationRepo.updatePostingResult(consolRefId, {
          sapRefDocument: sapRefDocument || null,
          postingStatus: requestedCode,
          httpStatus,
          errorCode: null,
          errorDetail: errorDetail || null
        }, actor);

        await transactionRepo.updatePostingResultStatus(consolRefId, result.statusCode, actor);

        await auditRepo.applyPostingResult({
          consolRefId,
          postingStatus: result.statusCode,
          errorCode: null,
          errorDetail: errorDetail || null,
          sapRefDocument: sapRefDocument || null,
          changedBy: actor
        });

        responses.push({
          ...response,
          statusCode: result.statusCode,
          message: result.statusCode === SC_POSTED
            ? `Posted successfully (SAP ${sapRefDocument})`
            : `Posting failed: ${errorDetail || 'Unknown error'}`
        });
      } catch (err) {
        responses.push({
          ...response,
          message: String(err.message || err).substring(0, 500)
        });
      }
    }

    return responses;
  };
};
