'use strict';

const ScenarioConfig = require('../config/ScenarioConfig');
const BuilderRegistry = require('../builders');
const MasterRepository = require('../repositories/MasterRepository');
const TransactionRepository = require('../repositories/TransactionRepository');
const ConsolidationRepository = require('../repositories/ConsolidationRepository');
const GLAccountRepository = require('../repositories/GLAccountRepository');
const AuditRepository = require('../repositories/AuditRepository');
const ReferenceNumberService = require('./ReferenceNumberService');
const ConsolidationSftpService = require('./ConsolidationSftpService');
const ConsolidationErrorReporter = require('./ConsolidationErrorReporter');
const { formatGlMessage } = require('../repositories/GLAccountRepository');

const Constants = require('../constants/ConsolidationConstants');
const DateUtil = require('../utils/DateUtil');
const NormalizeUtil = require('../utils/NormalizeUtil');
const IdUtil = require('../utils/IdUtil');

class ConsolidationService {
  constructor({
    masterRepository = new MasterRepository(),
    transactionRepository = new TransactionRepository(),
    consolidationRepository = new ConsolidationRepository(),
    glAccountRepository = new GLAccountRepository(),
    auditRepository = new AuditRepository({ softFail: false }),
    referenceNumberService = null,
    sftpService = null,
    errorReporter = null
  } = {}) {
    this.masterRepository = masterRepository;
    this.transactionRepository = transactionRepository;
    this.consolidationRepository = consolidationRepository;
    this.glAccountRepository = glAccountRepository;
    this.auditRepository = auditRepository;
    this.referenceNumberService = referenceNumberService
      || new ReferenceNumberService(consolidationRepository);
    this.sftpService = sftpService || new ConsolidationSftpService();
    this.errorReporter = errorReporter || new ConsolidationErrorReporter(this.sftpService);
  }

  async run(scenarioCode, params = {}) {
    const scenario = this._getScenario(scenarioCode);
    const BuilderClass = this._getBuilder(scenarioCode);
    const options = this._buildOptions(scenario, params);

    // Reset the reference-number counters so this run starts from the current DB
    // max (empty DB => 0001). Prevents a cached service from reusing/incrementing
    // a stale counter from a previous run.
    this.referenceNumberService.resetCounters?.();

    const runId = IdUtil.runId(scenario.code);
    const processStartAt = options.now || DateUtil.nowTimestamp();

    let runAudit = null;
    if (!options.dryRun) {
      runAudit = await this.auditRepository.createRun({
        runId, scenarioCode: scenario.code, status: 'STARTED',
        processStartAt,
        companyCode: options.companyCode,
        paymentType: scenario.outputPaymentType || scenario.code,
        paymentSubType: scenario.outputPaymentSubType || null,
        changedBy: options.requestedBy
      });
    }

    try {
      const records = await this.transactionRepository.findCandidates(scenario, options);

      if (!records.length) {
        const emptyResult = this._result({
          scenario, options, records, documents: [], transactionsUpdated: 0,
          errorRecords: [], runId,
          message: options.postingDate
            ? `No pending/retryable valid transactions found (postingDate=${options.postingDate}).`
            : 'No pending/retryable valid transactions found for consolidation.'
        });

        if (runAudit) {
          await this.auditRepository.completeRun(runAudit.AUDIT_ID, {
            status: 'SUCCESS', totalRecords: 0, successCount: 0, errorCount: 0,
            errorDetail: emptyResult.message, changedBy: options.requestedBy
          });
        }
        return emptyResult;
      }

      // ---- GL account validation ----
      const glLookup = await this.glAccountRepository.loadLookup(records);
      const glIssues = new Map(); // txnKey -> { statusCode, detail }

      for (const r of records) {
        const missing = glLookup.findMissingFields(r, scenario);
        if (missing.missing.length || missing.conflicts.length) {
          const msg = formatGlMessage(r, missing);
          glIssues.set(this.transactionKey(r), {
            statusCode: Constants.ERROR_TO_STATUS_CODE[Constants.ERROR_CODES.MISSING_GL_ACCOUNT],
            detail: msg
          });
        }
      }

      // ---- Master BP validation (on the GL-valid subset for efficiency) ----
      const glValidRecords = records.filter((r) => !glIssues.has(this.transactionKey(r)));
      const masterRows = await this.masterRepository.findActiveByLegacyIds(
        this._legacyIdsForBusinessPartnerLookup(scenario, glValidRecords)
      );
      const masterMap = this.masterRepository.buildBusinessPartnerMap(masterRows);

      const bpIssues = new Map();
      for (const r of glValidRecords) {
        const { valid, issues } = this.masterRepository.validateBusinessPartners(r, masterMap, scenario);
        if (!valid) {
          let statusCode = Constants.ERROR_TO_STATUS_CODE[Constants.ERROR_CODES.MISSING_BP_MASTER];
          for (const i of issues) {
            const mapped = Constants.ERROR_TO_STATUS_CODE[i.code];
            if (mapped) { statusCode = mapped; break; }
          }
          const msg = issues.map((i) => i.shortMessage).join('; ');
          bpIssues.set(this.transactionKey(r), { statusCode, detail: msg });
        }
      }

      // ---- Merge GL + BP issues per record; mark TX + write audit ----
      const errorRecords = []; // { record, statusCode, message }
      const missingKeySet = new Set();
      let errorRecordsUpdated = 0;

      for (const r of records) {
        const key = this.transactionKey(r);
        const gl = glIssues.get(key);
        const bp = bpIssues.get(key);

        if (!gl && !bp) continue;

        missingKeySet.add(key);

        const parts = [];
        let statusCode;
        if (gl) { parts.push(gl.detail); statusCode = statusCode || gl.statusCode; }
        if (bp) { parts.push(bp.detail); statusCode = statusCode || bp.statusCode; }

        // If both GL and BP, prefer the BP-specific code (057/058) over generic GL (056).
        if (gl && bp) statusCode = bp.statusCode;

        errorRecords.push({ record: r, statusCode, message: parts.join('; ') });
      }

      let consolidationErrorFile = null;

      // Records that passed both validations go on to be built.
      const recordsToConsolidate = records.filter((r) => !missingKeySet.has(this.transactionKey(r)));

      const context = {
        referenceNumberService: this.referenceNumberService,
        resolveMerchantBp: (r, s) => this.masterRepository.resolveMerchantBp(r, masterMap, {
          requireBusinessPartner: s.requireMerchantBusinessPartner
        }),
        resolveHostCustomerBp: (r, s) => this.masterRepository.resolveHostCustomerBp(r, masterMap, {
          requireBusinessPartner: s.requireHostCustomerNumber
        }),
        resolveGlAccount: (r, flagField) => {
          const gl = glLookup.resolve(r, flagField, scenario);
          if (!gl) {
            const missing = glLookup.findMissingFields(r, scenario);
            throw new Error(formatGlMessage(r, missing) || `Missing GL for ${flagField}`);
          }
          return gl;
        }
      };

      const builder = new BuilderClass(scenario);
      let documents = [];
      let unbalancedDocuments = [];

      if (recordsToConsolidate.length) {
        try {
          const built = await builder.buildDocuments(recordsToConsolidate, options, context);
          documents = Array.isArray(built) ? built : (built.documents || []);
          unbalancedDocuments = Array.isArray(built) ? [] : (built.unbalanced || []);
        } catch (error) {
          if (!options.dryRun) {
            const buildFailedCode = Constants.ERROR_TO_STATUS_CODE[Constants.ERROR_CODES.CONSOLIDATION_BUILD_FAILED];
            const detailByTransaction = new Map(
              recordsToConsolidate.map((r) => [
                this.transactionKey(r),
                String(error.message || 'Consolidation build failed').substring(0, 255)
              ])
            );

            errorRecordsUpdated += await this.transactionRepository.markRecoverableError(
              recordsToConsolidate, { consolStatus: buildFailedCode }, options.requestedBy
            );

            await this.auditRepository.insertTransactionErrors({
              runId, scenarioCode: scenario.code, records: recordsToConsolidate,
              errorCodeByTransaction: this._constantCodeMap(
                recordsToConsolidate, Constants.ERROR_CODES.CONSOLIDATION_BUILD_FAILED
              ),
              errorDetailByTransaction: detailByTransaction,
              defaultErrorCode: Constants.ERROR_CODES.CONSOLIDATION_BUILD_FAILED,
              processStartAt, changedBy: options.requestedBy
            });

            const totalErrors = recordsToConsolidate.length + errorRecords.length;
            if (runAudit) {
              await this.auditRepository.completeRun(runAudit.AUDIT_ID, {
                status: 'ERROR', totalRecords: records.length, successCount: 0,
                errorCount: totalErrors,
                errorCode: Constants.ERROR_CODES.CONSOLIDATION_BUILD_FAILED,
                errorDetail: String(error.message || 'Consolidation build failed').substring(0, 255),
                changedBy: options.requestedBy
              });
            }
          }
          throw error;
        }
      }

      // Point 5: unbalanced documents (debit != credit) are not consolidated.
      // Mark their source transactions with 055 CONSOLIDATION_FAILED and surface
      // them through the same error flow as GL/BP (audit + consolidation error file).
      const imbalanceCode = Constants.ERROR_TO_STATUS_CODE[Constants.ERROR_CODES.CONSOLIDATION_BUILD_FAILED];
      for (const doc of unbalancedDocuments) {
        const detail = builder.imbalanceDetail(doc);
        for (const r of (doc.sourceTransactions || [])) {
          const key = this.transactionKey(r);
          if (missingKeySet.has(key)) continue;
          missingKeySet.add(key);
          errorRecords.push({ record: r, statusCode: imbalanceCode, message: detail });
        }
      }

      // Process all recoverable errors (GL/BP + imbalance): mark TX + audit + error file.
      if (errorRecords.length && !options.dryRun) {
        const byCode = new Map();
        const detailByTxn = new Map();
        const codeByTxn = new Map();
        for (const e of errorRecords) {
          const k = this.transactionKey(e.record);
          if (!byCode.has(e.statusCode)) byCode.set(e.statusCode, []);
          byCode.get(e.statusCode).push(e.record);
          detailByTxn.set(k, e.message);
          codeByTxn.set(k, this._logicalCodeForStatus(e.statusCode));
        }

        for (const [code, recs] of byCode.entries()) {
          errorRecordsUpdated += await this.transactionRepository.markRecoverableError(
            recs, { consolStatus: code }, options.requestedBy
          );
        }

        await this.auditRepository.insertTransactionErrors({
          auditId: runAudit.AUDIT_ID, scenarioCode: scenario.code, records: errorRecords.map((e) => e.record),
          errorCodeByTransaction: codeByTxn,
          errorDetailByTransaction: detailByTxn,
          defaultErrorCode: Constants.ERROR_CODES.MISSING_BP_MASTER,
          processStartAt, changedBy: options.requestedBy
        });

        consolidationErrorFile = await this._writeConsolidationErrorReport({
          postingDate: options.postingDate,
          scenarioCode: scenario.code,
          errorRecords,
          changedBy: options.requestedBy,
          runId
        });
      }

      if (options.dryRun) {
        return this._result({
          scenario, options, records, documents, transactionsUpdated: 0,
          errorRecords,
          glAccountMissing: glIssues.size,
          bpMasterMissing: bpIssues.size,
          errorRecordsUpdated: 0, runId,
          consolidationErrorFile: null,
          message: 'Dry run completed. No database changes were written.'
        });
      }

      // All-or-nothing: if ANY record has a missing GL/BP (or an unbalanced
      // document), do NOT insert any documents. This stops CPI from posting a
      // partial journal entry now and a second one later once the missing GL/BP
      // is configured. The valid records simply stay pending and are retried
      // on the next run.
      if (documents.length && !errorRecords.length) {
        await this.consolidationRepository.insertDocuments(documents, runAudit?.AUDIT_ID || null);
        let transactionsUpdated = 0;
        for (const doc of documents) {
          transactionsUpdated += await this.transactionRepository.markPostingPending(
            doc.sourceTransactions, doc.header.CONSOL_REF_ID, options.requestedBy
          );
        }
        await this.auditRepository.insertDocumentSuccesses({
          runId, scenarioCode: scenario.code, documents, processStartAt, changedBy: options.requestedBy
        });
      }

      // Clean run: overwrite any previous consolidation error report with an
      // "issues fixed" notice (no rename dependency).
      if (!errorRecords.length) {
        const consolidatedTxns = documents.reduce((t, d) => t + (d.sourceTransactions?.length || 0), 0);
        const resolved = await this._resolveConsolidationErrorReport({
          postingDate: options.postingDate,
          consolidatedCount: consolidatedTxns,
          scenarioCode: scenario.code
        });
        if (resolved) consolidationErrorFile = resolved.fileName;
      }

      const skipped = errorRecords.length;
      const successTxnCount = documents.reduce((t, d) => t + (d.sourceTransactions?.length || 0), 0);
      const runStatus = successTxnCount > 0
        ? (skipped > 0 ? 'PARTIAL' : 'SUCCESS')
        : (skipped > 0 ? 'PARTIAL' : 'SUCCESS');

      if (runAudit) {
        await this.auditRepository.completeRun(runAudit.AUDIT_ID, {
          status: runStatus,
          totalRecords: records.length,
          successCount: successTxnCount,
          errorCount: skipped,
          errorCode: skipped ? this._primaryBlockedCode(errorRecords) : null,
          consolRefIds: documents.map((d) => d.header.CONSOL_REF_ID),
          changedBy: options.requestedBy
        });
      }

      return this._result({
        scenario, options, records, documents, transactionsUpdated: successTxnCount,
        errorRecords,
        glAccountMissing: glIssues.size,
        bpMasterMissing: bpIssues.size,
        errorRecordsUpdated, runId,
        consolidationErrorFile,
        message: skipped
          ? (successTxnCount > 0
              ? `Consolidation completed: ${successTxnCount} consolidated, ${skipped} recoverable errors written to AUDIT${consolidationErrorFile ? ' and ' + consolidationErrorFile.fileName : ''}.`
              : `Consolidation blocked: ${skipped} record(s) have missing GL/BP configuration. No documents were created (all-or-nothing)${consolidationErrorFile ? '; see ' + consolidationErrorFile.fileName : ''}.`)
          : 'Consolidation completed successfully'
      });
    } catch (error) {
      if (runAudit && !options.dryRun) {
        try {
          await this.auditRepository.completeRun(runAudit.AUDIT_ID, {
            status: 'ERROR', totalRecords: 0, successCount: 0, errorCount: 1,
            errorCode: Constants.ERROR_CODES.CONSOLIDATION_BUILD_FAILED,
            errorDetail: String(error.message || error).substring(0, 255),
            changedBy: options.requestedBy
          });
        } catch (auditErr) {
          console.error('[ConsolidationService] failed to complete run audit', auditErr);
        }
      }
      throw error;
    } finally {
      try { await this.sftpService?.disconnect?.(); }
      catch (_) { /* consolidation result is more important */ }
    }
  }

  /**
   * Requirement #5. Publish the GL/BP error report. SFTP problems must never
   * fail an otherwise-successful consolidation run.
   */
  async _writeConsolidationErrorReport(options) {
    try {
      return await this.errorReporter.writeErrorReport(options);
    } catch (error) {
      console.error('[ConsolidationService] Could not write consolidation error report:', error.message);
      return null;
    }
  }

  /**
   * Point 5. On a clean run, freeze any previous GL/BP error report by renaming
   * it to Transactions_YYYYMMDD_HHMMSS.csv. SFTP problems never fail the run.
   */
  async _resolveConsolidationErrorReport(options) {
    try {
      return await this.errorReporter.resolveErrorReport(options);
    } catch (error) {
      console.error('[ConsolidationService] Could not resolve consolidation error report:', error.message);
      return null;
    }
  }

  async updatePostingResult(scenarioCode, params = {}) {
    const scenario = this._getScenario(scenarioCode);
    const requestedBy = scenario.systemUser || Constants.SYSTEM_USERS.DEFAULT;

    const consolRefId = NormalizeUtil.text(params.consolRefId || params.CONSOL_REF_ID);
    const sapRefDocument = NormalizeUtil.text(params.sapRefDocument || params.SAP_REF_DOCUMENT);
    const requestedPostingStatus = NormalizeUtil.text(params.postingStatus || params.POSTING_STATUS);
    const httpStatus = params.httpStatus ?? params.HTTP_STATUS;
    const errorCode = NormalizeUtil.text(params.errorCode || params.ERROR_CODE);
    const errorDetail = NormalizeUtil.text(params.errorDetail || params.ERROR_DETAIL);

    if (['POSTED', 'SUCCESS', 'S', '03', Constants.POSTING_STATUS.POSTED].includes(requestedPostingStatus.toUpperCase())
        && !sapRefDocument) {
      throw new Error('SAP reference document is required when posting status is POSTED/SUCCESS');
    }

    const result = await this.consolidationRepository.updatePostingResult(consolRefId, {
      sapRefDocument, postingStatus: requestedPostingStatus,
      httpStatus, errorCode, errorDetail
    }, requestedBy);

    await this.transactionRepository.updatePostingResultStatus(consolRefId, result.statusCode, requestedBy);

    await this.auditRepository.applyPostingResult({
      consolRefId, postingStatus: result.statusCode, errorCode, errorDetail,
      sapRefDocument, changedBy: requestedBy
    });

    return {
      consolRefId, statusCode: result.statusCode, sapRefDocument,
      message: 'Posting result updated successfully (header, line items, transaction, audit)'
    };
  }

  _constantCodeMap(records, code) {
    const m = new Map();
    for (const r of records || []) m.set(this.transactionKey(r), code);
    return m;
  }

  _logicalCodeForStatus(statusCode) {
    for (const [name, sc] of Object.entries(Constants.ERROR_TO_STATUS_CODE)) {
      if (sc === statusCode) return name;
    }
    return Constants.ERROR_CODES.MISSING_BP_MASTER;
  }

  _primaryBlockedCode(errorRecords) {
    for (const e of errorRecords || []) {
      if (e.statusCode === Constants.ERROR_TO_STATUS_CODE[Constants.ERROR_CODES.MISSING_MERCHANT_BP]
          || e.statusCode === Constants.ERROR_TO_STATUS_CODE[Constants.ERROR_CODES.MISSING_HOST_CUSTOMER_BP]
          || e.statusCode === Constants.ERROR_TO_STATUS_CODE[Constants.ERROR_CODES.MISSING_BP_MASTER]) {
        return this._logicalCodeForStatus(e.statusCode);
      }
    }
    return Constants.ERROR_CODES.MISSING_GL_ACCOUNT;
  }

  _getScenario(scenarioCode) {
    const s = ScenarioConfig[scenarioCode];
    if (!s) throw new Error(`Unsupported consolidation scenario ${scenarioCode}`);
    return s;
  }

  _getBuilder(scenarioCode) {
    const B = BuilderRegistry[scenarioCode];
    if (!B) throw new Error(`No builder registered for consolidation scenario ${scenarioCode}`);
    return B;
  }

  _buildOptions(scenario, params) {
    return {
      companyCode: params.companyCode || null,
      postingDate: DateUtil.dbDate(params.postingDate),
      documentDate: DateUtil.dbDate(params.documentDate),
      baselineDate: DateUtil.dbDate(params.baselineDate),
      dryRun: params.dryRun === true || params.dryRun === 'true',
      requestedBy: scenario.systemUser || Constants.SYSTEM_USERS.DEFAULT,
      now: DateUtil.nowTimestamp()
    };
  }

  _legacyIdsForBusinessPartnerLookup(scenario, records) {
    const ids = [];
    for (const r of records || []) {
      if (scenario.requireMerchantBusinessPartner) ids.push(r.MERCHANT_ID);
      if (scenario.requireHostCustomerNumber) ids.push(r.HOST_NAME, NormalizeUtil.host(r.HOST_NAME));
    }
    return ids;
  }

  transactionKey(r) {
    return this.transactionRepository.transactionKey
      ? this.transactionRepository.transactionKey(r)
      : [r.COMPANY_CODE, r.MOBI_REFERENCE_ID, r.PAYMENT_TYPE].join('|');
  }

  _transactionKey(r) { return this.transactionKey(r); }

  _result({ scenario, options, records, documents, transactionsUpdated,
            errorRecords = [], glAccountMissing = 0, bpMasterMissing = 0,
            errorRecordsUpdated = 0, runId = null, consolidationErrorFile = null, message }) {
    const lineItemsCreated = documents.reduce((t, d) => t + d.lineItems.length, 0);

    return {
      scenario: scenario.code,
      dryRun: Boolean(options.dryRun),
      postingDate: options.postingDate || null,
      runId,
      inputTransactions: records.length,
      skippedTransactions: errorRecords.length,
      glAccountMissing,
      bpMasterMissing,
      errorRecordsUpdated,
      headersCreated: documents.length,
      lineItemsCreated,
      transactionsUpdated,
      consolRefIds: documents.map((d) => d.header.CONSOL_REF_ID).join(','),
      consolidationErrorFile: consolidationErrorFile ? consolidationErrorFile.fileName : '',
      message
    };
  }
}

module.exports = ConsolidationService;
