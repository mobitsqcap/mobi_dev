'use strict';

class CsvUtil {
  static parseNormalized(buffer) {
    const text = Buffer.from(buffer || '').toString('utf8').replace(/^\uFEFF/, '');
    if (!text.trim()) return { headers: [], rows: [], totalRows: 0 };

    const matrix = [];
    let row = [];
    let value = '';
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];

      if (quoted) {
        if (char === '"' && next === '"') { value += '"'; index += 1; }
        else if (char === '"') { quoted = false; }
        else { value += char; }
        continue;
      }

      if (char === '"') { quoted = true; }
      else if (char === ',') { row.push(value.trim()); value = ''; }
      else if (char === '\n' || char === '\r') {
        if (char === '\r' && next === '\n') index += 1;
        row.push(value.trim());
        value = '';
        if (row.some((cell) => cell !== '')) matrix.push(row);
        row = [];
      } else { value += char; }
    }

    if (quoted) {
      const error = new Error('CSV contains an unterminated quoted field');
      error.code = 'CSV_HEADER_MISMATCH';
      throw error;
    }

    row.push(value.trim());
    if (row.some((cell) => cell !== '')) matrix.push(row);

    if (!matrix.length) return { headers: [], rows: [], totalRows: 0 };

    // const headers = matrix[0].map((header) => header.trim());
        const headers = matrix[0].map((header) => header.trim().toLowerCase());
    const rows = matrix.slice(1).map((values) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = values[index] !== undefined ? values[index] : '';
      });
      return record;
    });

    return { headers, rows, totalRows: rows.length };
  }

  static serialize(headers, rows) {
    const escape = (input) => {
      const value = String(input ?? '');
      return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    };
    const lines = [headers.map(escape).join(',')];
    for (const row of rows || []) {
      lines.push(headers.map((header) => escape(row?.[header])).join(','));
    }
    return lines.join('\r\n');
  }
}

module.exports = CsvUtil;
