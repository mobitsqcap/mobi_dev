const crypto = require('crypto');

class HashUtil {
  static sha256(b) {
    return crypto.createHash('sha256').update(b).digest('hex');
  }
}

module.exports = HashUtil;
