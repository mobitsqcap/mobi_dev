'use strict';

class DateUtil {
  static nowTimestamp() { return new Date().toISOString(); }

  static dbDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);

    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    const slash = raw.split('/');
    if (slash.length === 3) {
      const [d, m, y] = slash;
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return raw;
  }

  static yyyymmdd(value) {
    const d = this.dbDate(value);
    if (!d) throw new Error('Posting date is required to build consolidation reference id');
    return d.replace(/-/g, '');
  }

  static date8(value) {
    const d = this.dbDate(value);
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d.replace(/-/g, '');
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  }

  static nowHHMMSS() {
    const d = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  }
}

module.exports = DateUtil;
