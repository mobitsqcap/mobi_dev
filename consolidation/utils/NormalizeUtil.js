'use strict';

const Constants = require('../constants/ConsolidationConstants');

class NormalizeUtil {
  static text(value) { return String(value ?? '').trim(); }
  static upper(value) { return this.text(value).toUpperCase(); }
  static compactUpper(value) { return this.upper(value).replace(/\s+/g, ''); }

  static normalizedWords(value) {
    return this.upper(value).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  static host(value) { return this.compactUpper(value); }

  static payment(value) {
    const n = this.normalizedWords(value);
    const aliases = {
      PAYINS: 'PAYIN', PAYIN: 'PAYIN',
      PAYOUTS: 'PAYOUT', PAYOUT: 'PAYOUT',
      NORMAL: 'NORMAL',
      'DOMESTIC SETTLEMENT': 'DOMESTIC SETTLEMENT',
      DOMESTICSETTLEMENT: 'DOMESTIC SETTLEMENT',
      DS: 'DOMESTIC SETTLEMENT'
    };
    return aliases[n] || n;
  }

  static paymentCode(value) {
    const n = this.payment(value);
    if (n === 'PAYIN') return Constants.PAYMENT_CODES.PAYIN;
    if (n === 'PAYOUT') return Constants.PAYMENT_CODES.PAYOUT;
    if (n === 'DOMESTIC SETTLEMENT') return Constants.PAYMENT_CODES.DOMESTIC_SETTLEMENT;
    if (n === 'NORMAL') return Constants.PAYMENT_CODES.NORMAL;
    return Constants.PAYMENT_CODES.UNKNOWN;
  }
}

module.exports = NormalizeUtil;
