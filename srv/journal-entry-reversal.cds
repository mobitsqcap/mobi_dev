using { mobi.db as db } from '../db/schema';

@path: 'journal-entry-reversal'
// @requires: ['authenticated-user', 'system-user']
service JournalEntryReversalService {

  @readonly
  @restrict: [
    { grant: 'READ', to: 'Read' },
    { grant: 'READ', to: 'OperationsTrigger' },
    { grant: 'READ', to: 'Jobs' }
  ]
  entity ReversalAudit as projection on db.MOBI_DB_AUDIT;

  type ReversalSyncResult {
    runId             : String(36);
    fromDate          : Date;
    toDate            : Date;
    read              : Integer;
    moved             : Integer;
    alreadyReversed   : Integer;
    ignoredNonBtp     : Integer;
    skipped           : Integer;
    failed            : Integer;
    transactionRows   : Integer;
    headerRows        : Integer;
    lineItemRows      : Integer;
    auditDetailRows   : Integer;
    reversedDocuments : array of {
      companyCode        : String(4);
      consolidationRefId : String(50);
      originalDocument   : String(20);
      reversalDocument   : String(20);
      transactionRows    : Integer;
      lineItemRows       : Integer;
    };
    message           : String(500);
  }

  // Job Scheduler calls this action with an empty JSON object. It processes
  // the previous complete Monday-Sunday week in Asia/Calcutta using SAP's
  // LastChangeDate field.
  //requires: ['OperationsTrigger', 'Jobs']
  action syncReversedDocuments() returns ReversalSyncResult;
}
