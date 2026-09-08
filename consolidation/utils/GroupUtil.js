'use strict';

class GroupUtil {
  static by(records, keyFn) {
    const map = new Map();
    for (const r of records || []) {
      const k = keyFn(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return map;
  }

  static first(records) { return Array.isArray(records) && records.length ? records[0] : null; }
}

module.exports = GroupUtil;
