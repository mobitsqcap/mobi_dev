'use strict';

module.exports = Object.freeze({
  DESTINATION_NAME: process.env.S4_REVERSAL_DESTINATION || 'S4HANA_MOBI',
  ENTITY_PATH: process.env.S4_REVERSAL_ENTITY_PATH ||
    '/sap/opu/odata/sap/YY1_JE_REVERSAL_CDS/YY1_JE_REVERSAL',
  TIME_ZONE: process.env.S4_REVERSAL_TIME_ZONE || 'Asia/Calcutta',
  POSTED_STATUS: '061',
  REVERSED_STATUS: '066',
  PAGE_SIZE: Number(process.env.S4_REVERSAL_PAGE_SIZE || 500),
  SYSTEM_USER: process.env.S4_REVERSAL_SYSTEM_USER || 'SYSTEM_SAP_REVERSAL'
});
