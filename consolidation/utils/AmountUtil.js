'use strict';

class AmountUtil {
  static toNumber(value) {
    if (value === undefined || value === null || String(value).trim() === '') return 0;
    const parsed = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  static toCents(value) { return Math.round(this.toNumber(value) * 100); }
  static fromCents(cents) { return Number((Number(cents || 0) / 100).toFixed(2)); }
  static round2(value) { return this.fromCents(this.toCents(value)); }

  static sum(records, fieldName) {
    const cents = (records || []).reduce((t, r) => t + this.toCents(r[fieldName]), 0);
    return this.fromCents(cents);
  }

  static sumBy(records, accessor) {
    const cents = (records || []).reduce((t, r) => t + this.toCents(accessor(r)), 0);
    return this.fromCents(cents);
  }

  static isNonZero(value) { return this.toCents(value) !== 0; }
}

module.exports = AmountUtil;
