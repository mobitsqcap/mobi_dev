'use strict';

class DateUtil {
  static parseCsvDate(value, { required = false } = {}) {
    if (value === undefined || value === null || !String(value).trim()) {
      return required
        ? { iso: null, formatted: null, error: 'MISSING_DATE' }
        : { iso: null, formatted: null, error: null };
    }

    const raw = String(value).trim();
    const parsed = this._tryParseFormats(raw);
    if (!parsed) return { iso: null, formatted: null, error: `INVALID_DATE_FORMAT: ${raw}` };

    const { day, month, year } = parsed;
    if (day < 1 || day > 31 || month < 1 || month > 12) {
      return { iso: null, formatted: null, error: `INVALID_DATE_VALUES: ${raw}` };
    }

    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const date = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
      return { iso: null, formatted: null, error: `INVALID_DATE_VALUES: ${raw}` };
    }

    return {
      iso,
      formatted: `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`,
      error: null
    };
  }

  static _tryParseFormats(raw) {
    let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (match) return { day: Number(match[3]), month: Number(match[2]), year: Number(match[1]) };

    match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (match) return this._dayMonth(Number(match[1]), Number(match[2]), Number(match[3]));

    match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
    if (match) return this._dayMonth(Number(match[1]), Number(match[2]), 2000 + Number(match[3]));

    return null;
  }

  static _dayMonth(first, second, year) {
    if (first > 12) return { day: first, month: second, year };
    if (second > 12) return { day: second, month: first, year };
    return { day: first, month: second, year };
  }

  static parseCsvTime(value) {
    if (value === undefined || value === null || !String(value).trim()) return null;
    const match = String(value).trim().match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] || 0);
    if (hours > 23 || minutes > 59 || seconds > 59) return null;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  static nowTimestamp() { return new Date(); }

  static nowHHMMSS() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  }

  static nowHCMSS() { return this.nowHHMMSS(); }

  static extractDate8(fileName) {
    const match = String(fileName || '').match(/_(\d{8})(?:_(?:ERRORS|Updated))?\.csv$/i);
    return match ? match[1] : null;
  }

  static isValidDate8(date8) {
    const match = String(date8 || '').match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!match) return false;
    const [, y, m, d] = match;
    const month = Number(m);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const iso = `${y}-${m}-${d}`;
    const date = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso;
  }
}

module.exports = DateUtil;
