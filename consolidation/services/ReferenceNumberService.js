'use strict';

const DateUtil = require('../utils/DateUtil');

class ReferenceNumberService {
  constructor(consolidationRepository) {
    this.consolidationRepository = consolidationRepository;
    this.consolCounters = new Map();
    this.sapCounters = new Map();
  }

  // Clear the in-memory counters so the next run re-reads the DB max sequence.
  // Without this, a cached singleton service remembers the previous run's
  // counter and keeps incrementing (e.g. 0001 -> 0002) even after documents
  // are deleted.
  resetCounters() {
    this.consolCounters.clear();
    this.sapCounters.clear();
  }

  async nextConsolRefId(scenario, companyCode, postingDate) {
    const prefix = `${companyCode}${scenario.refToken}${DateUtil.yyyymmdd(postingDate)}`;

    const next = await this._nextSequence(prefix, this.consolCounters, async () => {
      const existing = await this.consolidationRepository.findConsolRefsByPrefix(prefix);
      return (existing || []).map((r) => r.CONSOL_REF_ID);
    });

    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  async nextSapRefDocument(scenario) {
    const prefix = String(scenario.sapReferencePrefix || '9');
    const key = `SAP|${prefix}`;

    if (!this.sapCounters.has(key)) {
      const rows = await this.consolidationRepository.findSapRefsByPrefix(prefix);
      const nums = (rows || [])
        .map((r) => String(r.SAP_REF_DOCUMENT || ''))
        .filter((v) => /^\d+$/.test(v) && v.startsWith(prefix))
        .map((v) => Number(v));

      const defaultBase = Number(`${prefix}${'0'.repeat(7)}`);
      this.sapCounters.set(key, nums.length ? Math.max(...nums) : defaultBase);
    }

    const next = this.sapCounters.get(key) + 1;
    this.sapCounters.set(key, next);
    return String(next);
  }

  async _nextSequence(prefix, cache, loadExisting) {
    if (!cache.has(prefix)) {
      const existing = await loadExisting();
      const maxSeq = existing.reduce((m, v) => {
        const suffix = String(v || '').slice(prefix.length);
        const n = Number(suffix);
        return Number.isFinite(n) ? Math.max(m, n) : m;
      }, 0);
      cache.set(prefix, maxSeq);
    }

    const next = cache.get(prefix) + 1;
    cache.set(prefix, next);
    return next;
  }
}

module.exports = ReferenceNumberService;


