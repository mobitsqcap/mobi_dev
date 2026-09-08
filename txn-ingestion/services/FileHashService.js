  'use strict';

  const StatusCodeUtil = require('../utils/StatusCodeUtil');

  class FileHashService {
    constructor(fileLogRepository) {
      this.fileLogRepository = fileLogRepository;
    }

    async isDuplicateFile(hash) {
      const existing = await this.fileLogRepository.findByHash(hash);
      return Boolean(existing) && existing.STATUS_CODE === StatusCodeUtil.toCode('COMPLETED');
    }
  }

  module.exports = FileHashService;
