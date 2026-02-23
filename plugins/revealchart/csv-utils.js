// Shared CSV parsing and reference helpers used by chart/table preprocessors.

// Normalize supported CSS size inputs; plain numbers are interpreted as px.
// Regex purpose:
// - /^\d+(\.\d+)?$/ => numeric-only value (e.g. 400)
// - unit regex => allow px/vh/vw/%/rem/em explicitly
export function normalizeCssSize(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const raw = String(value).trim();
  if (!raw) return fallback;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    return `${raw}px`;
  }
  if (/^\d+(\.\d+)?(px|vh|vw|%|rem|em)$/.test(raw)) {
    return raw;
  }
  return fallback;
}

// Parse one CSV row with basic quote escaping ("").
export function parseCSVLine(line) {
  const cells = [];
  let value = '';
  let inQuotes = false;
  for (let idx = 0; idx < line.length; idx += 1) {
    const ch = line[idx];
    if (ch === '"') {
      if (inQuotes && line[idx + 1] === '"') {
        value += '"';
        idx += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(value);
      value = '';
      continue;
    }
    value += ch;
  }
  cells.push(value);
  return cells;
}

// Parse entire CSV text to a 2D row/column array.
export function parseCSVTable(csvText) {
  const rows = String(csvText || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line)
    .filter((line) => String(line).trim().length > 0)
    .map((line) => parseCSVLine(line));
  return rows.length ? rows : null;
}

// Coerce numeric strings to numbers; keep other values as strings.
export function toValue(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : text;
}

// Convert column refs to 0-based index: A -> 0, C -> 2, 1 -> 0, etc.
// Regex purpose:
// - /^\d+$/ numeric references
// - /^[A-Za-z]+$/ spreadsheet column letters
export function columnRefToIndex(ref) {
  if (typeof ref === 'number' && Number.isFinite(ref)) {
    return Math.max(0, Math.floor(ref) - 1);
  }
  const text = String(ref || '').trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    return Math.max(0, Number.parseInt(text, 10) - 1);
  }
  if (/^[A-Za-z]+$/.test(text)) {
    let idx = 0;
    const upper = text.toUpperCase();
    for (let i2 = 0; i2 < upper.length; i2 += 1) {
      idx = (idx * 26) + (upper.charCodeAt(i2) - 64);
    }
    return idx - 1;
  }
  return null;
}

// Convert row refs (1-based) to 0-based index.
export function rowRefToIndex(ref) {
  if (typeof ref === 'number' && Number.isFinite(ref)) {
    return Math.max(0, Math.floor(ref) - 1);
  }
  const text = String(ref || '').trim();
  if (!/^\d+$/.test(text)) return null;
  return Math.max(0, Number.parseInt(text, 10) - 1);
}

// Parse lists/ranges like "A,C,E", "B:D", "2:10" into index arrays.
// Regex purpose: /^([A-Za-z0-9]+)\s*[-:]\s*([A-Za-z0-9]+)$/ detects ranges.
export function parseRefList(input, parser) {
  if (input === undefined || input === null || input === '') return null;
  const raw = Array.isArray(input) ? input : String(input).split(/[, ]+/);
  const parsed = [];
  for (const part of raw) {
    if (part === undefined || part === null || String(part).trim() === '') continue;
    const text = String(part).trim();
    const rangeMatch = text.match(/^([A-Za-z0-9]+)\s*[-:]\s*([A-Za-z0-9]+)$/);
    if (rangeMatch) {
      const start = parser(rangeMatch[1]);
      const end = parser(rangeMatch[2]);
      if (start === null || end === null) continue;
      const dir = start <= end ? 1 : -1;
      for (let idx = start; idx !== end + dir; idx += dir) {
        parsed.push(idx);
      }
      continue;
    }
    const single = parser(text);
    if (single !== null) parsed.push(single);
  }
  return parsed.length ? parsed : null;
}

// Safe cell accessor for sparse CSV rows.
export function getCell(rows, rowIdx, colIdx) {
  const row = rows[rowIdx];
  if (!row) return '';
  return row[colIdx] ?? '';
}

// Escape text inserted inside HTML content nodes.
export function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
