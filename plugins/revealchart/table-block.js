// plugins/revealchart/table-block.js  (browser ES module; pure, no DOM)
// Read and write a `:table:` YAML block as plain objects, plus the field list the table dialog
// needs. Used by table-builder.js. Same approach as chart-block.js: items stay parsed objects,
// the dialog only touches the keys listed here and every other key passes through untouched.
// Tables only ever read a CSV file (`datasource`), so the GUI is mostly "which file, which
// columns, how to show them"; the per-column align / format / summary maps become one rule list.
// Gotcha: saving re-dumps the YAML, so key order is kept but comments are lost.
import { parseItemsBlock, buildItemsBlock } from './chart-block.js';

export function parseTableBlock(raw, yaml) {
  return parseItemsBlock(raw, yaml, 'table');
}

export function buildTableBlock(items, yaml, meta = {}) {
  return buildItemsBlock(items, yaml, meta, 'table');
}

export function defaultTableItem() {
  return { class: 'lighttable' };
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---- datasource file (a string, or an object with file / path / src) -------------------------

export function getDatasourceFile(item) {
  const ds = item.datasource;
  if (isPlainObject(ds)) return String(ds.file ?? ds.path ?? ds.src ?? '');
  return ds === undefined || ds === null ? '' : String(ds);
}

// Set the CSV path, keeping the object form (and the key it uses) when there is one.
export function setDatasourceFile(item, file) {
  const text = String(file).trim();
  const ds = item.datasource;
  if (isPlainObject(ds)) {
    const key = ['file', 'path', 'src'].find((k) => k in ds) || 'file';
    if (text) ds[key] = text; else delete ds[key];
    return;
  }
  if (text) item.datasource = text; else delete item.datasource;
}

// ---- plain top-level fields ------------------------------------------------------------------
// kind 'text' or 'select' ('' means "default", the key is left out); numeric: whole numbers are
// written as numbers so `headerRow: 1` stays a number.

export const TABLE_FIELDS = [
  { key: 'class', kind: 'select', label: 'Style', choices: ['', 'lighttable', 'darktable'] },
  { key: 'height', kind: 'text', label: 'Height', placeholder: '320px, 45vh' },
  { key: 'overflow', kind: 'select', label: 'Overflow', choices: ['', 'auto', 'scroll', 'hidden'] },
  { key: 'dataColumns', kind: 'text', label: 'Columns to show', placeholder: 'A,C:F' },
  { key: 'dataRows', kind: 'text', label: 'Rows to show', placeholder: '2:10' },
  { key: 'headerRow', kind: 'text', label: 'Header row', placeholder: '1', numeric: true },
  { key: 'align', kind: 'select', label: 'Default alignment', choices: ['', 'left', 'center', 'right'] },
  { key: 'format', kind: 'select', label: 'Default format', choices: ['', 'normal', 'currency', 'percentage'] },
  { key: 'currency', kind: 'text', label: 'Currency code', placeholder: 'USD' },
  { key: 'id', kind: 'text', label: 'ID', placeholder: 'attendance-table' },
  { key: 'dataId', kind: 'text', label: 'Data ID (auto-animate)', placeholder: 'attendance-window' }
];

export function getField(item, field) {
  const value = item[field.key];
  return value === undefined || value === null ? '' : String(value);
}

export function setField(item, field, value) {
  const text = String(value).trim();
  if (!text) delete item[field.key];
  else item[field.key] = field.numeric && /^\d+$/.test(text) ? Number(text) : text;
}

// includeHeader defaults to true; only `false` is written.
export const getIncludeHeader = (item) => item.includeHeader !== false;
export function setIncludeHeader(item, on) {
  if (on) delete item.includeHeader; else item.includeHeader = false;
}

// ---- per-column rules ------------------------------------------------------------------------
// The three maps (alignColumns, formatColumns, summarizeColumns) viewed as rows:
// { column: 'C', align: 'right', format: 'currency', summarize: 'sum' }.

export const RULE_MAPS = { align: 'alignColumns', format: 'formatColumns', summarize: 'summarizeColumns' };
export const RULE_CHOICES = {
  align: ['', 'left', 'center', 'right'],
  format: ['', 'normal', 'currency', 'percentage'],
  summarize: ['', 'sum', 'average']
};

// Null when any map uses the list form or an alias key (columnAlign…), which the rule list can't
// show without rewriting it; the dialog then points to the YAML tab.
export function columnRules(item) {
  const aliases = ['columnAlign', 'alignments', 'columnFormats', 'formats', 'columnSummaries', 'summaries'];
  if (aliases.some((k) => k in item)) return null;
  const rules = new Map();
  for (const [field, mapKey] of Object.entries(RULE_MAPS)) {
    const map = item[mapKey];
    if (map === undefined || map === null) continue;
    if (!isPlainObject(map)) return null;
    for (const [column, value] of Object.entries(map)) {
      if (!rules.has(column)) rules.set(column, { column, align: '', format: '', summarize: '' });
      rules.get(column)[field] = String(value ?? '');
    }
  }
  return [...rules.values()];
}

// Write the rule rows back into the three maps; rows without a column are skipped.
export function applyColumnRules(item, rules) {
  for (const [field, mapKey] of Object.entries(RULE_MAPS)) {
    const map = {};
    for (const rule of rules) {
      const column = String(rule.column).trim();
      if (column && rule[field]) map[column] = rule[field];
    }
    if (Object.keys(map).length) item[mapKey] = map; else delete item[mapKey];
  }
}
