'use strict';

const cds = require('@sap/cds');
const { SELECT } = cds.ql;

const Constants = require('../utils/Constants');

const ENTITY = 'mobi.db.MOBI_DB_MASTER';

class MasterRepository {
  async findActiveForValidation() {
    const db = await cds.connect.to('db');
    return db.run(
      SELECT.from(ENTITY)
        .columns('ID', 'MOBI_PORTAL_CODE', 'SAP_COMPANY_CODE', 'TYPE', 'COUNTRY_CODE')
        .where({ ACTIVE_FLAG: Constants.ACTIVE_FLAG })
    );
  }
}

module.exports = MasterRepository;
