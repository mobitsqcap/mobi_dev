using { mobi.db as db } from '../db/schema';

// Interactive users authenticate through XSUAA; Job Scheduler and CPI use
// client-credentials tokens and are represented by CAP as system-user.
// @requires: ['authenticated-user', 'system-user']
service IngestionMasterService {

  // Preserve the existing projection capabilities for Master-BP administrators.
  // Trigger operators receive read-only visibility for operational support.
  @restrict: [
    { grant: '*',    to: 'AdminMasterBP' },
    { grant: 'READ', to: 'OperationsTrigger' },
    { grant: 'READ', to: 'PostingCallback' }
  ]
  entity Master as projection on db.MOBI_DB_MASTER;

  @restrict: [
    { grant: '*',    to: 'AdminMasterBP' },
    { grant: 'READ', to: 'OperationsTrigger' }
  ]
  entity FileLogs as projection on db.MOBI_DB_FILELOG;

  @restrict: [
    { grant: '*',    to: 'AdminMasterBP' },
    { grant: 'READ', to: 'OperationsTrigger' }
  ]
  entity FileBatches as projection on db.MOBI_DB_FILEBATCH;

  function getStatus() returns String;

  // Human operators use OperationsTrigger; scheduled executions use Jobs.
  // @requires: ['OperationsTrigger', 'Jobs']
  action triggerMasterIngestion() returns {
    filesProcessed : Integer;
    message        : String;
    logs           : array of String;
  };

  // Restricted to the CPI/OAuth posting-callback identity. A normal trigger
  // operator cannot overwrite BP status or create CPI audit rows.
  @requires: 'PostingCallback'
  action replicateMasterStatusToAudit(
    items : array of {
      ID             : String(20);
      BP_NUMBER      : String(20);
      POSTING_STATUS : String(2);
      STATUS_CODE    : String(3);
      ERROR_DETAIL   : String(500);
    }
  ) returns {
    updated    : Integer;
    message    : String;
    merchantId : String(20);
    BP_NUMBER  : String(20);
  };

  @requires: 'AdminMasterBP'
  action lookupMerchant(
    portalCode  : String(2),
    companyCode : String(4),
    merchantId  : String(20)
  ) returns {
    found        : Boolean;
    countryCode  : String(2);
    merchantName : String(40);
    activeFlag   : String(1);
  };
}
