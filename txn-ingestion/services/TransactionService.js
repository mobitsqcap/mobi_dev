'use strict';

const cds = require('@sap/cds');

const Constants = require('../utils/Constants');
const DateUtil = require('../utils/DateUtil');

class TransactionService {
  constructor(transactionRepository) {
    this.transactionRepository = transactionRepository;
  }

  _toDbRecord(record) {
    const {
      _ROW_NUMBER,
      _RAW_ROW,
      _DATE_ERRORS,
      _AUDIT_RECORD_ID,
      _VALIDATION_ERRORS,
      STATUS_MESSAGE,
      ...dbRecord
    } = record;

    for (const key of Object.keys(dbRecord)) {
      if (dbRecord[key] === undefined) delete dbRecord[key];
    }
    return dbRecord;
  }

  async insertAllAtomic(records, batchSize) {
    if (!records?.length) return;

    const db = await cds.connect.to('db');
    const now = DateUtil.nowTimestamp();

    const enriched = records.map((record) => ({
      ...this._toDbRecord(record),
      CREATED_BY: Constants.SYSTEM_USERS.SFTP,
      CREATED_TIMESTAMP: now,
      CHANGED_BY: '',
      CHANGED_TIMESTAMP: null
    }));

    await db.tx(async (transaction) => {
      for (let index = 0; index < enriched.length; index += batchSize) {
        await this.transactionRepository.insertBatch(
          enriched.slice(index, index + batchSize),
          transaction
        );
      }
    });
  }
}

module.exports = TransactionService;
