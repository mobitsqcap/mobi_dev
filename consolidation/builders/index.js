'use strict';

module.exports = Object.freeze({
  PAYIN: require('./PayinConsolidationBuilder'),
  PAYOUT: require('./PayoutConsolidationBuilder'),
  DOMESTIC_SETTLEMENT: require('./DomesticSettlementConsolidationBuilder')
});
