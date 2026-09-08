'use strict';

const cds = require('@sap/cds');
const { SELECT, INSERT } = cds.ql;

const ENTITY = 'mobi.db.MOBI_DB_TRANSACTION';
const QUERY_CHUNK_SIZE = 500;

class TransactionRepository {
  async findExistingMobiReferenceIds(ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    const result = new Set();
    if (!unique.length) return result;

    const db = await cds.connect.to('db');
    for (let index = 0; index < unique.length; index += QUERY_CHUNK_SIZE) {
      const rows = await db.run(
        SELECT.from(ENTITY)
          .columns('MOBI_REFERENCE_ID')
          .where({ MOBI_REFERENCE_ID: { in: unique.slice(index, index + QUERY_CHUNK_SIZE) } })
      );
      for (const row of rows || []) result.add(String(row.MOBI_REFERENCE_ID));
    }
    return result;
  }

  async findHostReferenceDates(ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    const result = [];
    if (!unique.length) return result;

    const db = await cds.connect.to('db');
    for (let index = 0; index < unique.length; index += QUERY_CHUNK_SIZE) {
      const rows = await db.run(
        SELECT.from(ENTITY)
          .columns('HOST_REFERENCE_ID', 'TXN_CREATED_DATE', 'TXN_PAID_DATE')
          .where({ HOST_REFERENCE_ID: { in: unique.slice(index, index + QUERY_CHUNK_SIZE) } })
      );
      result.push(...(rows || []));
    }
    return result;
  }

  async insertBatch(records, runner = null) {
    if (!records?.length) return;
    const db = runner || await cds.connect.to('db');
    await db.run(INSERT.into(ENTITY).entries(records));
  }
}

module.exports = TransactionRepository;

