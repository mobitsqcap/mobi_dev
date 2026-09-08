'use strict';


const cds = require('@sap/cds');
const { SELECT } = cds.ql;

const EntityNames = require('../constants/EntityNames');
const Constants = require('../constants/ConsolidationConstants');
const NormalizeUtil = require('../utils/NormalizeUtil');

class MasterRepository {
  async findActiveByLegacyIds(legacyIds) {
    const ids = [...new Set(
      (legacyIds || [])
        .filter((id) => id != null && String(id).trim() !== '')
        .map((id) => String(id).trim())
    )];
    if (!ids.length) return [];

    const db = await cds.connect.to('db');
    const rows = await db.run(
      SELECT.from(EntityNames.MASTER).where({ ID: { in: ids } })
    );

    return (rows || []).filter((r) => this._isActive(r));
  }

  _isActive(row) {
    const flag = NormalizeUtil.upper(row.ACTIVE_FLAG ?? row.Active_Flag ?? row.active_flag);
    return flag === 'X' || flag === 'TRUE' || flag === 'Y' || flag === '1' || flag === 'ACTIVE';
  }

  _readExternalBp(m) {
    return NormalizeUtil.text(
      m.EXTERNAL_BP_NUMBER ?? m.External_Bp_Number ?? m.external_bp_number ?? m._EXTERNAL_BP_NUMBER
    );
  }

  _readBpNumber(m) {
    return NormalizeUtil.text(
      m.BP_NUMBER ?? m.Bp_Number ?? m.bp_number ?? m._BP_NUMBER
    );
  }

  buildBusinessPartnerMap(masterRows) {
    const map = new Map();

    for (const m of masterRows || []) {
      const id = NormalizeUtil.text(m.ID ?? m.Id ?? m.id);
      const portal = NormalizeUtil.upper(m.MOBI_PORTAL_CODE);
      const company = NormalizeUtil.upper(m.SAP_COMPANY_CODE ?? m.COMPANY_CODE ?? m.Sap_Company_Code);
      const enriched = {
        ...m, ID: id,
        _EXTERNAL_BP_NUMBER: this._readExternalBp(m),
        _BP_NUMBER: this._readBpNumber(m)
      };

      const idsToIndex = [...new Set([id, NormalizeUtil.host(id)].filter(Boolean))];

      for (const idToIndex of idsToIndex) {
        if (portal && company && idToIndex) {
          map.set(`${portal}|${company}|${idToIndex}`.toUpperCase(), enriched);
        }
        if (company && idToIndex) {
          map.set(`*|${company}|${idToIndex}`.toUpperCase(), enriched);
        }
        if (idToIndex) {
          map.set(`*|*|${idToIndex}`.toUpperCase(), enriched);
        }
      }
    }

    return map;
  }

  resolveMerchantBp(record, masterMap, { requireBusinessPartner = true } = {}) {
    const result = this.tryResolveMerchantBp(record, masterMap, { requireBusinessPartner });
    if (!result.valid) throw new Error(result.message);
    return { externalBpNumber: result.externalBpNumber, bpNumber: result.bpNumber };
  }

  resolveHostCustomerBp(record, masterMap, { requireBusinessPartner = true } = {}) {
    const result = this.tryResolveHostCustomerBp(record, masterMap, { requireBusinessPartner });
    if (!result.valid) throw new Error(result.message);
    return { externalBpNumber: result.externalBpNumber, bpNumber: result.bpNumber };
  }

  validateBusinessPartners(record, masterMap, scenario) {
    const issues = [];

    if (scenario.requireMerchantBusinessPartner) {
      const mr = this.tryResolveMerchantBp(record, masterMap, { requireBusinessPartner: true });
      if (!mr.valid) {
        issues.push({ kind: 'merchant', code: mr.code, shortMessage: shortBpMessage('merchant', record.MERCHANT_ID, mr.code) });
      }
    }

    if (scenario.requireHostCustomerNumber) {
      const hr = this.tryResolveHostCustomerBp(record, masterMap, { requireBusinessPartner: true });
      if (!hr.valid) {
        issues.push({ kind: 'host', code: hr.code, shortMessage: shortBpMessage('host', record.HOST_NAME, hr.code) });
      }
    }

    return { valid: issues.length === 0, issues };
  }

  tryResolveMerchantBp(record, masterMap, { requireBusinessPartner = true } = {}) {
    return this._tryResolveLegacyBp({
      record, masterMap,
      legacyId: NormalizeUtil.text(record.MERCHANT_ID), label: 'merchant',
      externalMissingCode: Constants.ERROR_CODES.MISSING_MERCHANT_BP,
      bpMissingCode: Constants.ERROR_CODES.MISSING_BP_MASTER,
      requireBusinessPartner
    });
  }

  tryResolveHostCustomerBp(record, masterMap, { requireBusinessPartner = true } = {}) {
    return this._tryResolveLegacyBp({
      record, masterMap,
      legacyId: NormalizeUtil.text(record.HOST_NAME), label: 'host customer',
      externalMissingCode: Constants.ERROR_CODES.MISSING_HOST_CUSTOMER_BP,
      bpMissingCode: Constants.ERROR_CODES.MISSING_BP_MASTER,
      requireBusinessPartner
    });
  }

  _tryResolveLegacyBp({
    record, masterMap, legacyId, label, externalMissingCode,
    bpMissingCode, requireBusinessPartner
  }) {
    const portal = NormalizeUtil.upper(record.MOBI_PORTAL_CODE);
    const company = NormalizeUtil.upper(record.COMPANY_CODE);
    const id = NormalizeUtil.text(legacyId);

    if (!id) {
      return {
        valid: false, code: externalMissingCode,
        message: `${label} legacy id is missing for company ${company}, portal ${portal}`,
        externalBpNumber: null, bpNumber: null, master: null
      };
    }

    const idsToLookup = [...new Set([id, NormalizeUtil.host(id)].filter(Boolean))];
    let master = null;

    const key = (k) => k.toUpperCase();
    for (const idToLookup of idsToLookup) {
      master = masterMap.get(key(`${portal}|${company}|${idToLookup}`))
           || masterMap.get(key(`*|${company}|${idToLookup}`))
           || masterMap.get(key(`*|*|${idToLookup}`));
      if (master) break;
    }

    if (!master) {
      return {
        valid: false, code: externalMissingCode,
        message: `${label} master not found/inactive for legacy id ${id}, company ${company}, portal ${portal}. Please verify the ID exists and is active in master data.`,
        externalBpNumber: null, bpNumber: null, master: null
      };
    }

    const externalBpNumber = NormalizeUtil.text(master._EXTERNAL_BP_NUMBER || this._readExternalBp(master));
    const bpNumber = NormalizeUtil.text(master._BP_NUMBER || this._readBpNumber(master));

    if (!externalBpNumber && requireBusinessPartner) {
      return {
        valid: false, code: externalMissingCode,
        message: `EXTERNAL_BP_NUMBER missing in master for ${label} legacy id ${id}, company ${company}, portal ${portal}`,
        externalBpNumber: null, bpNumber: bpNumber || null, master
      };
    }

    if (!bpNumber && requireBusinessPartner) {
      return {
        valid: false, code: bpMissingCode,
        message: `BP_NUMBER missing in master for ${label} legacy id ${id}, company ${company}, portal ${portal}`,
        externalBpNumber: externalBpNumber || null, bpNumber: null, master
      };
    }

    return {
      valid: true, code: null, message: null,
      externalBpNumber: externalBpNumber || null, bpNumber: bpNumber || null, master
    };
  }
}

function shortBpMessage(kind, legacyId, code) {
  const label = kind === 'host' ? 'host BP' : 'merchant BP';
  const id = NormalizeUtil.text(legacyId) || '<empty>';

  if (code === Constants.ERROR_CODES.MISSING_BP_MASTER) {
    return `Missing BP_NUMBER for ${label}: ${id}`;
  }
  return `Missing ${label}: ${id}`;
}

module.exports = MasterRepository;
