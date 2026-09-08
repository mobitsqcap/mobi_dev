function splitCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') { current += '"'; i++; }
      else if (char === '"') inQuotes = false;
      else current += char;
    } else {
      if (char === '"') inQuotes = true;
      else if (char === ',') { values.push(current); current = ''; }
      else current += char;
    }
  }
  values.push(current);
  return values.map((v) => v.trim());
}

class CsvUtil {
  static serialize(headers, rows) {
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map((h) => {
        const val = String(row[h] ?? '');
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          return '"' + val.replace(/"/g, '""') + '"';
        }
        return val;
      }).join(','));
    }
    return lines.join('\n');
  }

  static parseNormalized(buffer) {
    const text  = Buffer.from(buffer).toString('utf-8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    const headers = splitCsvLine(lines[0] || '');
    const rows = lines.slice(1).map((line) => {
      const values = splitCsvLine(line);
      const row = {};
      headers.forEach((h, i) => { row[h] = values[i] !== undefined ? values[i] : ''; });
      return row;
    });
    return { headers, rows, totalRows: rows.length };
  }

  static parse(buffer, auditId) {
    const n = this.parseNormalized(buffer);
    return {
      totalRows: n.totalRows,
      records: n.rows.map((row) => ({ ...row, AUDIT_ID: auditId || '' }))
    };
  }
}

module.exports = CsvUtil;
