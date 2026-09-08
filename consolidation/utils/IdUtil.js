'use strict';

const crypto = require('crypto');

class IdUtil {
  static uuid() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return crypto.randomBytes(16).toString('hex')
      .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  }

  static runId(scenarioCode = 'CONSOL') {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `${String(scenarioCode).toUpperCase()}-${stamp}-${suffix}`.substring(0, 50);
  }
}

module.exports = IdUtil;
