'use strict';

function normalizeDocument(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  // SAP accounting documents are numeric. Normalize leading zeroes so that
  // 7350000025 and 07350000025 refer to the same document.
  if (/^\d+$/.test(raw)) return raw.replace(/^0+(?=\d)/, '');
  return raw;
}

module.exports = { normalizeDocument };
