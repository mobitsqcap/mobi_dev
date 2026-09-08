const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;
const Constants = require('../utils/Constants');

class MasterRepository {
  async upsertBatch(records, { chunkSize = Number(process.env.DB_CHUNK_SIZE || 2000) } = {}) {
    if (!records.length) return;
    const db = await cds.connect.to('db');
    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize);
      await db.run(INSERT.into('mobi.db.MOBI_DB_MASTER').entries(chunk));
    }
  }

  async updateMasterStatus(payload) {
    const db = await cds.connect.to('db');
    const bp = String(payload.BP_NUMBER || '').trim();
    const isSuccess = (bp.length > 0 && bp.toLowerCase() !== 'null') || payload.STATUS_CODE === '063';
    const statusCode = isSuccess ? '063' : (payload.STATUS_CODE || '100');
    return db.run(
      UPDATE('mobi.db.MOBI_DB_MASTER')
        .set({
          BP_NUMBER: payload.BP_NUMBER,
          POSTING_STATUS: payload.POSTING_STATUS || statusCode,
          ERROR_DETAIL: payload.ERROR_DETAIL || '',
          STATUS_CODE: statusCode,
          ERROR_CODE: payload.ERROR_CODE || '',
          CHANGED_BY: ''
        })
        .where({ ID: payload.ID })
    );
  }

  async updateMasterStatusBatch(items) {
    const db = await cds.connect.to('db');
    return db.tx(async tx => {
      const promises = items.map(item => {
        const bp = String(item.BP_NUMBER || '').trim();
        const isSuccess = (bp.length > 0 && bp.toLowerCase() !== 'null') || item.STATUS_CODE === '063';
        const statusCode = isSuccess ? '063' : (item.STATUS_CODE || '100');
        return tx.run(
          UPDATE('mobi.db.MOBI_DB_MASTER')
            .set({
              BP_NUMBER: item.BP_NUMBER,
              POSTING_STATUS: item.POSTING_STATUS || statusCode,
              ERROR_DETAIL: item.ERROR_DETAIL || '',
              STATUS_CODE: statusCode,
              ERROR_CODE: item.ERROR_CODE || '',
              CHANGED_BY: ''
            })
            .where({ ID: item.ID })
        );
      });
      const results = await Promise.all(promises);
      return results.reduce((acc, cur) => acc + cur, 0);
    });
  }

  async findActive(portalCode, companyCode, id) {
    const db = await cds.connect.to('db');
    return db.run(
      SELECT.one.from('mobi.db.MOBI_DB_MASTER').where({
        MOBI_PORTAL_CODE: portalCode,
        SAP_COMPANY_CODE: companyCode,
        ID: id,
        ACTIVE_FLAG: Constants.ACTIVE_FLAG
      })
    );
  }

  async findActiveByIds(ids) {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    if (!uniqueIds.length) return [];
    const db = await cds.connect.to('db');
    return db.run(
      SELECT.from('mobi.db.MOBI_DB_MASTER').where({
        ID: { in: uniqueIds },
        ACTIVE_FLAG: Constants.ACTIVE_FLAG
      })
    );
  }

  async buildExistingKeySet(ids) {
    const uniqueIds = [...new Set((ids || []).filter(Boolean).map(id => String(id).trim().toUpperCase()))];
    if (!uniqueIds.length) return new Set();
    const db = await cds.connect.to('db');
    const rows = await db.run(
      SELECT.from('mobi.db.MOBI_DB_MASTER')
        .columns('MOBI_PORTAL_CODE', 'SAP_COMPANY_CODE', 'ID')
        .where({ ID: { in: uniqueIds } })
    );
    const keySet = new Set();
    for (const r of rows || []) {
      const portal = String(r.MOBI_PORTAL_CODE || '').trim().toUpperCase();
      const company = String(r.SAP_COMPANY_CODE || '').trim();
      const id = String(r.ID || '').trim().toUpperCase();
      if (id) {
        keySet.add(id);
        if (portal && company) {
          keySet.add(`${portal}|${company}|${id}`);
        }
      }
    }
    return keySet;
  }

  async findActiveRecordsByIds(ids) {
    return this.findActiveByIds(ids);
  }

  async findCrossCompanyCodeDuplicates(ids) {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    if (!uniqueIds.length) return [];
    const db = await cds.connect.to('db');
    return db.run(
      SELECT.from('mobi.db.MOBI_DB_MASTER')
        .columns('ID', 'SAP_COMPANY_CODE', 'MOBI_PORTAL_CODE', 'MASTER_NAME')
        .where({ ID: { in: uniqueIds }, ACTIVE_FLAG: Constants.ACTIVE_FLAG })
    );
  }
}

module.exports = MasterRepository;
