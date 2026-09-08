class DateUtil {
  static nowTimestamp() { return new Date().toISOString(); }

  static extractDate8(fileName) {
    const match = String(fileName || '').match(/_(\d{8})\.csv$/i);
    return match ? match[1] : '';
  }

  static nowHCMSS() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  }
}

module.exports = DateUtil;
