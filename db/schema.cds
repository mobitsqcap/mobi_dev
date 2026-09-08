namespace mobi.db;

entity MOBI_DB_STATUS {
  key STATUS_CODE : String(3);
      DESCRIPTION : String(100);
}

entity MOBI_DB_MASTER {
  key ID                          : String(20);
      AUDIT_ID                    : String(36);
      MOBI_PORTAL_CODE            : String(2);
      SAP_COMPANY_CODE            : String(4);
      TYPE                        : String(20);
      ADDRESS1                    : String(255);
      POSTAL_CODE                 : String(10);
      COUNTRY                     : String(80);
      COUNTRY_CODE                : String(2);
      BUSINESS_REG_NO_TIN         : String(50);
      MASTER_NAME                 : String(40);
      EXTERNAL_BP_NUMBER          : String(20);
      BP_NUMBER                   : String(10);
      GROUPING                    : String(4);
      NAME                        : String(40);
      STREET                      : String(60);
      COUNTRY_REGION              : String(10);
      BP_TAX_LONG_NUMBER          : String(50);
      LANGUAGE                    : String(2);
      RECONCILIATION_ACCOUNT      : String(10);
      CHECK_DUPLICATE_INVOICE_IND : String(1);
      PURCHASING_ORGANIZATION     : String(4);
      GR_BASED_INVOICE_IND        : String(1);
      BUSINESS_PARTNER_CATEGORY   : String(1);
      BUSINESS_PARTNER_ROLE       : String(20);
      SALES_ORGANIZATION          : String(4);
      ACTIVE_FLAG                 : String(1);
      STATUS_CODE                 : String(3);
      FILE_ID                     : String(64);
      FILE_NAME                   : String(100);
      RECORD_NUMBER               : Integer;
      BP_CREATION_DATE            : Timestamp;
      CREATED_BY                  : String(100);
      CREATED_TIMESTAMP           : Timestamp;
      CHANGED_BY                  : String(100);
      CHANGED_TIMESTAMP           : Timestamp;
}

entity MOBI_DB_AUDIT {
  key AUDIT_ID          : UUID;
  key AUDIT_LINE_ITEM   : Integer;
      PROCESS_NAME      : String(50);
      PROCESS_TYPE      : String(20);
      MESSAGE_TYPE      : String(1);
      STATUS_MESSAGE    : String(500);
      CREATED_BY        : String(100);
      CREATED_TIMESTAMP : Timestamp;
}

entity MOBI_DB_TRANSACTION {
  key COMPANY_CODE          : String(4);
  key MOBI_REFERENCE_ID     : String(100);
  key PAYMENT_TYPE          : String(20);
      AUDIT_ID              : String(36);
      MOBI_PORTAL_CODE      : String(2);
      MERCHANT_ID           : String(20);
      MERCHANT_TYPE         : String(50);
      MERCHANT_NAME         : String(100);
      TXN_CREATED_DATE      : Date;
      TXN_PAID_DATE         : Date;
      TXN_CREATED_TIME      : Time;
      TXN_PAID_TIME         : Time;
      TIME_ZONE             : String(3);
      PAYMENT_SUB_TYPE      : String(30);
      PAYMENT_METHOD        : String(15);
      HOST_NAME             : String(15);
      TXN_CURRENCY          : String(3);
      TXN_AMOUNT            : Decimal(18, 2);
      HOST_MDR_AMOUNT       : Decimal(18, 2);
      HOST_FEE_PAYABLE      : Decimal(18, 2);
      MOBI_MDR_AMOUNT       : Decimal(18, 2);
      MDR_REVENUE           : Decimal(18, 2);
      AR_PAYIN              : Decimal(18, 2);
      AP_PAYIN              : Decimal(18, 2);
      AP_PAYOUT             : Decimal(18, 2);
      HOST_REFERENCE_ID     : String(100);
      MERCHANT_REFERENCE_ID : String(100);
      TXN_STATUS            : String(15);
      BALANCE_CHECK         : Decimal(8, 5);
      ORIGINAL_AMOUNT       : Decimal(18, 2);
      SETTLED_IN_CURRENCY   : String(3);
      CONVERSION_RATE       : Decimal(20, 8);
      COUNTRY_CODE          : String(2);
      CONSOL_REF_ID         : String(50);
      STATUS_CODE           : String(20);
      CREATED_BY            : String(100);
      CREATED_TIMESTAMP     : Timestamp;
      CHANGED_BY            : String(100);
      CHANGED_TIMESTAMP     : Timestamp;
}

entity MOBI_DB_FILELOG {
  key AUDIT_ID          : String(36);
      FILE_ID           : String(64);
      FILE_NAME         : String(100);
      FILE_PATH         : String(200);
      FILE_SIZE_BYTES   : Integer;
      FILE_HASH         : String(64);
      ROW_COUNT_TOTAL   : Integer;
      ROW_COUNT_VALID   : Integer;
      ROW_COUNT_ERROR   : Integer;
      STATUS            : String(30);
      STATUS_CODE       : String(3);
      ERROR_DETAIL      : String(500);
      RECEIVED_AT       : Timestamp;
      PROCESS_START_AT  : Timestamp;
      PROCESS_END_AT    : Timestamp;
      CREATED_BY        : String(100);
      CREATED_TIMESTAMP : Timestamp;
      CHANGED_BY        : String(100);
      CHANGED_TIMESTAMP : Timestamp;
}

entity MOBI_DB_FILEBATCH {
  key AUDIT_ID      : String(36);
  key BATCH_NO      : Integer;
      FILE_NAME     : String(100);
      START_INDEX   : Integer;
      END_INDEX     : Integer;
      STATUS        : String(30);
      STATUS_CODE   : String(3);
      TOTAL_RECORDS : Integer;
      SUCCESS_COUNT : Integer;
      ERROR_COUNT   : Integer;
      START_TIME    : Timestamp;
      END_TIME      : Timestamp;
      ERROR_DETAIL  : String(255);
}

entity MOBI_DB_CONSOLIDATIONHEADER {
  key CONSOL_REF_ID       : String(50);
      AUDIT_ID            : String(36);
      SAP_REF_DOCUMENT    : String(20);
      COMPANY_CODE        : String(4);
      MOBI_PORTAL_CODE    : String(2);
      PAYMENT_TYPE        : String(20);
      PAYMENT_SUB_TYPE    : String(30);
      DOCUMENT_TYPE       : String(2);
      POSTING_DATE        : Date;
      DOCUMENT_DATE       : Date;
      BASELINE_DATE       : Date;
      TOTAL_DEBIT_AMOUNT  : Decimal(18, 2);
      TOTAL_CREDIT_AMOUNT : Decimal(18, 2);
      CURRENCY            : String(3);
      POST_DATE           : Timestamp;
      HTTP_STATUS         : Integer;
      STATUS_CODE         : String(3);
      RETRY_COUNT         : Integer;
      CREATED_BY          : String(100);
      CREATED_TIMESTAMP   : Timestamp;
      CHANGED_BY          : String(100);
      CHANGED_TIMESTAMP   : Timestamp;
}

entity MOBI_DB_CONSOLIDATIONLINEITEM {
  key CONSOL_REF_ID          : String(50);
  key DOC_REF_ITEM           : Integer;
      AUDIT_ID               : String(36);
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
      HOST_MDR_AMOUNT        : Decimal(18, 2);
      HOST_FEE_PAYABLE       : Decimal(18, 2);
      MDR_REVENUE            : Decimal(18, 2);
      AR_PAYIN               : Decimal(18, 2);
      AP_PAYIN               : Decimal(18, 2);
      AP_PAYOUT              : Decimal(18, 2);
      TRANSACTION_AMOUNT     : Decimal(18, 2);
      GL_ACCOUNT             : String(10);
      DEBIT_CREDIT_INDICATOR : String(1);
      COST_CENTER            : String(10);
      PROFIT_CENTER          : String(10);
      DOCUMENT_TYPE          : String(2);
      POST_DATE              : Timestamp;
      HTTP_STATUS            : Integer;
      STATUS_CODE            : String(3);
      RETRY_COUNT            : Integer;
      CREATED_BY             : String(100);
      CREATED_TIMESTAMP      : Timestamp;
      CHANGED_BY             : String(100);
      CHANGED_TIMESTAMP      : Timestamp;
}

entity MOBI_DB_GLAccounts {
  key GUID              : String(36);
  key GL_Accounts       : String(8);
      COMPANY_CODE      : String(4);
      PAYMENT_TYPE      : String(20);
      PAYMENT_SUB_TYPE  : String(30);
      HOST_NAME         : String(15);
      TXN_AMOUNT        : String(1);
      HOST_MDR_AMOUNT   : String(1);
      HOST_FEE_PAYABLE  : String(1);
      MOBI_MDR_AMOUNT   : String(1);
      MDR_REVENUE       : String(1);
      Status            : String(2);
      CREATED_BY        : String(100);
      CREATED_TIMESTAMP : Timestamp;
      CHANGED_BY        : String(100);
      CHANGED_TIMESTAMP : Timestamp;
}
