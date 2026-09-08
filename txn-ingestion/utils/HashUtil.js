'use strict';

const crypto = require('crypto');

class HashUtil {
  static sha256(bufferOrString) {
    return crypto.createHash('sha256').update(bufferOrString).digest('hex');
  }
}

module.exports = HashUtil;
