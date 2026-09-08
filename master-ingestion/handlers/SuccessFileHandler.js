class SuccessFileHandler {
  constructor(sftpService) { this.sftpService = sftpService; }

  async handle(file, result, context = {}) {
    const targetPath = context.completedPath;
    if (!targetPath) {
      throw new Error(`Completed path missing for file ${file.name}. Please check SFTP folder configuration.`);
    }

    try {
      await this.sftpService.moveFile(file.path, targetPath);
      file.path = targetPath;
    } catch (err) {
      console.warn(`[SuccessFileHandler] Failed to move ${file.name} to ${targetPath}: ${err.message}. Audit log will be updated.`);
      throw err;
    }
  }
}

module.exports = SuccessFileHandler;
