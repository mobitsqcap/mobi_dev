'use strict';

const cds = require('@sap/cds');
const { v4: uuid } = require('uuid');

const Constants = require('../txn-ingestion/utils/Constants');
const StatusCodeUtil = require('../txn-ingestion/utils/StatusCodeUtil');

const SftpService = require('../txn-ingestion/services/SftpService');
const TransactionCsvService = require('../txn-ingestion/services/TransactionCsvService');
const TransactionService = require('../txn-ingestion/services/TransactionService');
const ValidationService = require('../txn-ingestion/services/ValidationService');
const BatchProcessingService = require('../txn-ingestion/services/BatchProcessingService');
const FileHashService = require('../txn-ingestion/services/FileHashService')
const MasterRepository = require('../txn-ingestion/repositories/MasterRepository');
const TransactionRepository = require('../txn-ingestion/repositories/TransactionRepository');
const FileLogRepository = require('../txn-ingestion/repositories/FileLogRepository');
const FileBatchRepository = require('../txn-ingestion/repositories/FileBatchRepository');
const AuditRepository = require('../txn-ingestion/repositories/AuditRepository');

const TechnicalValidator = require('../txn-ingestion/validators/TechnicalValidator');
const BusinessValidator = require('../txn-ingestion/validators/BusinessValidator');
const CurrencyValidator = require('../txn-ingestion/validators/CurrencyValidator');
const AmountValidator = require('../txn-ingestion/validators/AmountValidator');
const DuplicateValidator = require('../txn-ingestion/validators/DuplicateValidator');

const ErrorFileHandler = require('../txn-ingestion/handlers/ErrorFileHandler');
const SuccessFileHandler = require('../txn-ingestion/handlers/SuccessFileHandler');
const TransactionFileHandler = require('../txn-ingestion/handlers/TransactionFileHandler');
const UnifiedIngestionHandler = require('../txn-ingestion/handlers/UnifiedIngestionHandler');

let transactionRunInProgress = false;

module.exports = cds.service.impl(async function transactionIngestionService() {
  await StatusCodeUtil.ensureStatusTable();

  const masterRepository = new MasterRepository();
  const transactionRepository = new TransactionRepository();
  const fileLogRepository = new FileLogRepository();
  const fileBatchRepository = new FileBatchRepository();
  const auditRepository = new AuditRepository();
  const sftpService = new SftpService();

  const validationService = new ValidationService({
    technicalValidator: new TechnicalValidator(),
    businessValidator: new BusinessValidator(),
    currencyValidator: new CurrencyValidator(),
    amountValidator: new AmountValidator(),
    duplicateValidator: new DuplicateValidator(transactionRepository),
    masterRepository
  });

  const transactionService = new TransactionService(transactionRepository);

  const batchProcessingService = new BatchProcessingService({
    validationService,
    transactionService,
    fileBatchRepository
  });

  const fileHashService = new FileHashService(fileLogRepository);

  const transactionFileHandler = new TransactionFileHandler({
    sftpService,
    csvService: new TransactionCsvService(),
    batchProcessingService,
    fileLogRepository,
    auditRepository,
    fileHashService,
    successFileHandler: new SuccessFileHandler(sftpService),
    errorFileHandler: new ErrorFileHandler(sftpService),
    systemUser: Constants.SYSTEM_USERS.SFTP
  });

  const unifiedIngestionHandler = new UnifiedIngestionHandler({
    sftpService,
    transactionFileHandler
  });

  const actorOf = (request) =>
    request?.user?.id ||
    request?.user?.attr?.email ||
    request?.user?.attr?.user_name ||
    Constants.SYSTEM_USERS.SFTP;

  this.on('getStatus', () => 'Transaction ingestion service is up');

  this.on('triggerTransactionIngestion', async (request) => {
    if (transactionRunInProgress) {
      return {
        filesProcessed: 0,
        message: 'Transaction ingestion is already running.',
        logs: []
      };
    }

    transactionRunInProgress = true;
    sftpService.clearTrace();

    try {
      const result = await unifiedIngestionHandler.handle({
        actor: actorOf(request),
        runId: uuid()
      });

      return {
        filesProcessed: Number(result.filesProcessed || 0),
        message: 'Transaction ingestion cycle completed.',
        logs: [...sftpService.getTrace(), ...(result.logs || [])]
      };
    } catch (error) {
      return {
        filesProcessed: 0,
        message: `Transaction ingestion failed: ${error.message}`,
        logs: [...sftpService.getTrace(), `Transaction ingestion failed: ${error.message}`]
      };
    } finally {
      try {
        await sftpService.disconnect();
      } catch (_) {
      }
      transactionRunInProgress = false;
    }
  });
});
