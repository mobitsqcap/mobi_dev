'use strict';

class SuccessFileHandler {
  constructor(sftpService) {
    this.sftpService = sftpService;
  }

  async handle(file, context) {
    const { processingPath, completedPath } = context;
    if (!completedPath) throw new Error(`Completed path missing for file ${file.name}`);
    await this.sftpService.moveFile(processingPath, completedPath);
    file.path = completedPath;
  }
}

module.exports = SuccessFileHandler;