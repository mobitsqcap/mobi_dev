const Constants = require('./Constants');

class FileTypeUtil {
 
  static isValidDateYYYYMMDD(dateStr) {
    if (!/^\d{8}$/.test(dateStr)) return false;
    const year = Number(dateStr.substring(0, 4));
    const month = Number(dateStr.substring(4, 6));
    const day = Number(dateStr.substring(6, 8));
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;

    const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    if (isLeapYear) daysInMonth[2] = 29;

    return day <= daysInMonth[month];
  }

  static classify(fileName) {
    const masterMatch = String(fileName || '').match(/^Master_(\d{8})\.csv$/i);
    if (masterMatch && this.isValidDateYYYYMMDD(masterMatch[1])) {
      return 'MASTER';
    }
    const txnMatch = String(fileName || '').match(/^Transactions_(\d{8})\.csv$/i);
    if (txnMatch && this.isValidDateYYYYMMDD(txnMatch[1])) {
      return 'TRANSACTION';
    }
    return 'INVALID';
  }

  static expectedFormat(fileType) {
    if (fileType === 'MASTER') return Constants.MASTER_EXPECTED_FORMAT;
    if (fileType === 'TRANSACTION') return Constants.TRANSACTION_EXPECTED_FORMAT;
    return `${Constants.MASTER_EXPECTED_FORMAT} / ${Constants.TRANSACTION_EXPECTED_FORMAT}`;
  }

  static extractDateNumber(fileName) {
    const match = String(fileName || '').match(/_(\d{8})\.csv$/i);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  }

  static sortForProcessing(files) {
    const priority = { filein: 0, processing: 1 };
    return [...files].sort((a, b) => {
      const pa = priority[a.source] ?? 99;
      const pb = priority[b.source] ?? 99;
      if (pa !== pb) return pa - pb;
      const da = this.extractDateNumber(a.name);
      const db = this.extractDateNumber(b.name);
      if (da !== db) return da - db;
      return a.name.localeCompare(b.name);
    });
  }
}

module.exports = FileTypeUtil;
