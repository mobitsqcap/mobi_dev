const cds = require('@sap/cds');
const { v4: uuid } = require('uuid');
const Constants = require('../master-ingestion/utils/Constants');
const StatusCodeUtil = require('../master-ingestion/utils/StatusCodeUtil');

const SftpService = require('../master-ingestion/services/SftpService');
const MasterCsvService = require('../master-ingestion/services/MasterCsvService');
const MasterUpsertService = require('../master-ingestion/services/MasterUpsertService');
const FileHashService = require('../master-ingestion/services/FileHashService');

const MasterRepository = require('../master-ingestion/repositories/MasterRepository');
const FileLogRepository = require('../master-ingestion/repositories/FileLogRepository');
const AuditRepository = require('../master-ingestion/repositories/AuditRepository');

const ErrorFileHandler = require('../master-ingestion/handlers/ErrorFileHandler');
const SuccessFileHandler = require('../master-ingestion/handlers/SuccessFileHandler');
const MasterFileHandler = require('../master-ingestion/handlers/MasterFileHandler');
const UnifiedIngestionHandler = require('../master-ingestion/handlers/UnifiedIngestionHandler');

module.exports = cds.service.impl(async function () {
  await StatusCodeUtil.ensureStatusTable();

  // ---------------------------------------------------------------
  // Repositories
  // ---------------------------------------------------------------
  const masterRepository = new MasterRepository();
  const fileLogRepository = new FileLogRepository();
  const auditRepository = new AuditRepository();

  // ---------------------------------------------------------------
  // Services
  // ---------------------------------------------------------------
  const sftpService = new SftpService();
  const masterCsvService = new MasterCsvService();
  const masterUpsertService = new MasterUpsertService(masterRepository);
  const fileHashService = new FileHashService(fileLogRepository);

  // ---------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------
  const errorFileHandler = new ErrorFileHandler(sftpService);
  const successFileHandler = new SuccessFileHandler(sftpService);
  const masterFileHandler = new MasterFileHandler({
    sftpService,
    fileHashService,
    csvService: masterCsvService,
    masterUpsertService,
    masterRepository,
    fileLogRepository,
    auditRepository,
    successFileHandler,
    errorFileHandler,
    systemUser: Constants.SYSTEM_USERS.SFTP,
    batchSize: Number(process.env.BATCH_SIZE || Constants.BATCH_SIZE)
  });

  const unifiedIngestionHandler = new UnifiedIngestionHandler({
    sftpService,
    errorFileHandler,
    fileLogRepository,
    auditRepository,
    masterFileHandler,
    masterRepository,
    masterCsvService
  });

  // ---------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------
  const actorOf = (req) =>
    req?.user?.id || req?.user?.attr?.email || req?.user?.attr?.user_name || 'UNKNOWN_USER';

  this.on('getStatus', () => 'Master ingestion service is up');

  this.on('triggerMasterIngestion', async (req) => {
    sftpService.clearTrace();
    const runId = uuid();
    const actor = actorOf(req);
    try {
      const result = await unifiedIngestionHandler.handle({ actor, runId });
      return {
        filesProcessed: Number(result?.filesProcessed || 0),
        message: 'Master batch ingestion cycle completed successfully.',
        logs: [...sftpService.getTrace(), ...(result?.logs || [])]
      };
    } catch (error) {
      console.error(`[IngestionMasterService] ${error.stack || error.message}`);
      return {
        filesProcessed: 0,
        message: `Master ingestion failed: ${error.message}`,
        logs: [...sftpService.getTrace(), `Master ingestion failed: ${error.message}`]
      };
    } finally {
      try {
        await sftpService.disconnect();
      } catch (_) {
        /* ignore */
      }
    }
  });

  this.on('replicateMasterStatusToAudit', async (req) => {
    const items = req.data?.items || [];
    if (!items.length) {
      return {
        updated: 0,
        updatedCount: 0,
        message: 'No items provided',
        merchantId: null,
        BP_NUMBER: null
      };
    }
    try {
      // 1. Bulk Update Master Table (sets STATUS_CODE = '063' on success)
      const masterCount = await masterRepository.updateMasterStatusBatch(items);

      // 2. Create new rows in MOBI_DB_AUDIT (PROCESS_TYPE = 'CPI TO SAP', PROCESS_NAME = 'INTEGRATION', etc.)
      const auditCount = await auditRepository.createRecordAuditFromCPIBatch(items);

      return {
        updated: masterCount,
        updatedCount: masterCount,
        message: `Processed ${items.length} records. Master updated: ${masterCount}, Audit rows created: ${auditCount}`,
        merchantId: items[0]?.ID || null,
        BP_NUMBER: items[0]?.BP_NUMBER || null
      };
    } catch (err) {
      console.error('[IngestionMasterService] Batch Error:', err);
      return req.error(500, `Batch update failed: ${err.message}`);
    }
  });
  this.on('lookupMerchant', async (req) => {
    const { portalCode, companyCode, merchantId } = req.data || {};
    const row = await masterRepository.findActive(portalCode, companyCode, merchantId);
    if (!row) return { found: false, countryCode: null, merchantName: null, activeFlag: null };
    return {
      found: true,
      countryCode: row.COUNTRY_CODE || null,
      merchantName: row.MASTER_NAME || null,
      activeFlag: row.ACTIVE_FLAG || null
    };
  });
});
