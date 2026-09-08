const DateUtil = require('../utils/DateUtil');

class MasterUpsertService {
  constructor(masterRepository) {
    this.masterRepository = masterRepository;
  }

  async upsertBatch(records, fileId, fileName, auditId) {
    if (!records.length) return;
    const now = DateUtil.nowTimestamp();
    const enriched = records.map((record, index) => ({
      ...record,
      AUDIT_ID: auditId,
      FILE_ID: fileId,
      FILE_NAME: fileName,
      RECORD_NUMBER: index + 1,
      POSTING_STATUS: '01',
      STATUS_CODE: '006', // 'SUCCESS' so CPI picks it up!
      BP_CREATION_DATE: now,
      CREATED_BY: 'SYSTEM_SFTP', // always the system user for the master flow
      CREATED_TIMESTAMP: now,
      CHANGED_BY: ''
    }));
    await this.masterRepository.upsertBatch(enriched);
  }
}

module.exports = MasterUpsertService;
