using { mobi.db as db } from '../db/schema';

// Interactive users authenticate through XSUAA; Job Scheduler and CPI use
// client-credentials tokens and are represented by CAP as system-user.
@requires: ['authenticated-user', 'system-user']
service PayoutConsolidationService {

  @cds.persistence.skip
  @restrict: [
    { grant: 'READ',   to: 'Read' },
    { grant: 'READ',   to: 'OperationsTrigger' },
    { grant: 'UPDATE', to: 'OperationsTrigger' },
    { grant: 'READ',   to: 'PostingCallback' }
  ]
  entity LineItems {
    key CONSOL_REF_ID          : String(50);
    key DOC_REF_ITEM           : Integer;
        SAP_REF_DOCUMENT       : String(20);
        COMPANY_CODE           : String(4);
        MOBI_PORTAL_CODE       : String(2);
        PAYMENT_TYPE           : String(20);
        PAYMENT_SUB_TYPE       : String(30);
        MERCHANT_ID            : String(20);
        SAP_SUPPLIER_NUMBER    : String(10);
        SAP_CUSTOMER_NUMBER    : String(10);
        POSTING_DATE           : Date;
        DOCUMENT_DATE          : Date;
        BASELINE_DATE          : Date;
        HOST_NAME              : String(15);
        CURRENCY               : String(3);
        HOST_MDR_AMOUNT        : Decimal(18,2);
        HOST_FEE_PAYABLE       : Decimal(18,2);
        MDR_REVENUE            : Decimal(18,2);
        AP_PAYOUT              : Decimal(18,2);
        TRANSACTION_AMOUNT     : Decimal(18,2);
        GL_ACCOUNT             : String(10);
        DEBIT_CREDIT_INDICATOR : String(1);
        COST_CENTER            : String(10);
        PROFIT_CENTER          : String(10);
        DOCUMENT_TYPE          : String(2);
        STATUS_CODE            : String(3);
        CONSOL_STATUS          : String(3);
        POST_DATE              : Timestamp;
        HTTP_STATUS            : Integer;
        RETRY_COUNT            : Integer;
        CREATED_BY             : String(50);
        CREATED_TIMESTAMP      : Timestamp;
        CHANGED_BY             : String(50);
        CHANGED_TIMESTAMP      : Timestamp;
  }

  type PayoutConsolidationRunResult {
    scenario               : String(40);
    dryRun                 : Boolean;
    inputTransactions      : Integer;
    skippedTransactions    : Integer;
    glAccountMissing       : Integer;
    bpMasterMissing        : Integer;
    errorRecordsUpdated    : Integer;
    headersCreated         : Integer;
    lineItemsCreated       : Integer;
    transactionsUpdated    : Integer;
    consolRefIds           : String(5000);
    consolidationErrorFile : String(200);
    message                : String(500);
  }

  // Human operators use OperationsTrigger; scheduled executions use Jobs.
  @requires: ['OperationsTrigger', 'Jobs']
  action runPayoutConsolidation(
    companyCode  : String(4),
    postingDate  : Date,
    documentDate : Date,
    baselineDate : Date,
    dryRun       : Boolean
  ) returns PayoutConsolidationRunResult;

  @requires: 'PostingCallback'
  action updateBatchPostingResults(items : array of {
    consolRefId    : String(50);
    sapRefDocument : String(20);
    statusCode     : String(3);
    httpStatus     : Integer;
    errorDetail    : String(255);
  }) returns array of {
    consolRefId    : String(50);
    sapRefDocument : String(20);
    statusCode     : String(3);
    httpStatus     : Integer;
    errorDetail    : String(500);
    message        : String(500);
  };
}
