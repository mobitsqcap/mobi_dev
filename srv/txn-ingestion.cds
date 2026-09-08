using { mobi.db as db } from '../db/schema';

// Interactive users authenticate through XSUAA; Job Scheduler uses a
// client-credentials token and is represented by CAP as system-user.
// @requires: ['authenticated-user', 'system-user']
service IngestiontxnService {

  @readonly
  @restrict: [
    { grant: 'READ', to: 'Read' },
    { grant: 'READ', to: 'OperationsTrigger' }
  ]
  entity Audit as projection on db.MOBI_DB_AUDIT;

  @readonly
  @restrict: [
    { grant: 'READ', to: 'Read' },
    { grant: 'READ', to: 'OperationsTrigger' }
  ]
  entity FileLogs as projection on db.MOBI_DB_FILELOG;

  @readonly
  @restrict: [
    { grant: 'READ', to: 'Read' },
    { grant: 'READ', to: 'OperationsTrigger' }
  ]
  entity FileBatches as projection on db.MOBI_DB_FILEBATCH;

  function getStatus() returns String;

  // Human operators use OperationsTrigger; scheduled executions use Jobs.
  // @requires: ['OperationsTrigger', 'Jobs']
  action triggerTransactionIngestion() returns {
    filesProcessed : Integer;
    message        : String;
    logs           : array of String;
  };
}
