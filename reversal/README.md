# SAP journal-entry reversal sync

The `JournalEntryReversalService.syncReversedDocuments` action:

1. Calculates the previous complete Monday-Sunday week in `Asia/Calcutta`.
2. Requests only `IsReversal eq true` rows whose `LastChangeDate` is inside that week from the SAP OData V2 CDS view.
3. Matches `CompanyCode + ReverseDocument` to the active consolidation header's `COMPANY_CODE + SAP_REF_DOCUMENT`.
4. Accepts only posted consolidation records (`STATUS_CODE = 061`).
5. Inserts full snapshots into the three reversal tables with status `066`, then deletes active line items, headers, and transactions in one CAP database transaction.
6. Writes `SAP_REVERSAL / S4_TO_BTP` summary and detail rows to `MOBI_DB_AUDIT`. The generated reversal run UUID is written to `AUDIT_ID` in the three reversal snapshots; the source rows are copied otherwise unchanged.

The configured destination must be named `S4HANA_MOBI` and must point to the SAP API host, for example `https://my436974-api.s4hana.cloud.sap`, not only the browser/UI host.
