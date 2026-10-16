// plugins/revealchart/chart-block.js  (browser ES module; pure, no DOM)
// Read and write a `:chart:` YAML block as plain objects, plus the data the chart dialog needs.
// Used by chart-builder.js (the Rich Builder dialog) for card edit and the Animation menu entry.
// Design: each chart item is kept as the parsed object and the dialog only touches the few paths
// it knows (type, size, data grid, COMMON_OPTIONS); every other key, including the whole Chart.js
// `options` tree, passes through untouched and is edited as raw YAML. So Chart.js options never
// need mapping into form fields. Add a row to COMMON_OPTIONS or SNIPPETS to expose more.
// Block parsing reuses parseYamlBlockLines() from markdown-preprocessor.js; `yaml` is a js-yaml
// instance (the builder page provides window.jsyaml).
// Gotcha: saving re-dumps the YAML, so key order is kept but comments are lost.
import { parseYamlBlockLines } from './markdown-preprocessor.js';
import { parseCSVTable, toValue } from './csv-utils.js';

export const CHART_TYPES = ['bar', 'line', 'pie', 'doughnut', 'radar', 'polarArea', 'scatter', 'bubble'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---- block <-> items -------------------------------------------------------------------------

// Parse a raw `:chart:` block. Returns { items, shape, extras, indent } or null when the YAML is
// malformed or holds something other than chart objects. `shape` records the source form
// ('items' for {items:[...]}, 'array', 'single') so it can be written back the same way;
// `extras` are other top-level keys next to `items`.
export function parseChartBlock(raw, yaml) {
  return parseItemsBlock(raw, yaml, 'chart');
}

// Shared with table-block.js: `marker` is the tag name without colons ('chart' / 'table').
export function parseItemsBlock(raw, yaml, marker) {
  const parseYAML = (text) => yaml.loadAll(text)[0] ?? null;
  const block = parseYamlBlockLines(String(raw || '').split('\n'), 0, marker, parseYAML);
  if (!block || block.parsed === undefined) return null;
  const parsed = block.parsed;
  const indent = String(raw).match(/^ */)[0];
  let items;
  let shape = 'items';
  let extras = {};
  if (parsed === null) {
    items = [];
  } else if (Array.isArray(parsed)) {
    items = parsed;
    shape = 'array';
  } else if (isPlainObject(parsed) && Array.isArray(parsed.items)) {
    ({ items, ...extras } = parsed);
  } else if (isPlainObject(parsed)) {
    items = [parsed];
    shape = 'single';
  } else {
    return null;
  }
  if (!items.every(isPlainObject)) return null;
  return { items, shape, extras, indent };
}

// Build block text from items. A 'single' or 'array' source keeps its form while it still fits.
export function buildChartBlock(items, yaml, meta = {}) {
  return buildItemsBlock(items, yaml, meta, 'chart');
}

export function buildItemsBlock(items, yaml, { shape = 'items', extras = {}, indent = '' } = {}, marker) {
  const list = items.filter(isPlainObject);
  let out;
  if (shape === 'single' && list.length === 1) out = list[0];
  else if (shape === 'array') out = list;
  else out = { ...extras, items: list };
  const body = list.length
    ? yaml.dump(out, { lineWidth: -1, skipInvalid: true }).trimEnd().split('\n').map((line) => `${indent}  ${line}`)
    : [];
  return [`${indent}:${marker}:`, ...body].join('\n');
}

export function defaultChartItem() {
  return {
    type: 'bar',
    height: '400px',
    width: '100%',
    data: {
      labels: ['Jan', 'Feb', 'Mar'],
      datasets: [{ label: 'Dataset 1', data: [3, 7, 4] }]
    }
  };
}

// ---- dotted-path helpers ---------------------------------------------------------------------

export function getPath(obj, path) {
  let cur = obj;
  for (const key of path.split('.')) {
    if (!isPlainObject(cur) || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(cur[key])) cur[key] = {};
    cur = cur[key];
  }
  cur[keys[keys.length - 1]] = value;
  return obj;
}

// Remove a path and any parent objects left empty by it.
export function unsetPath(obj, path) {
  const keys = path.split('.');
  const trail = [obj];
  let cur = obj;
  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(cur[key])) return obj;
    cur = cur[key];
    trail.push(cur);
  }
  delete cur[keys[keys.length - 1]];
  for (let i = trail.length - 1; i > 0; i -= 1) {
    if (Object.keys(trail[i]).length) break;
    delete trail[i - 1][keys[i - 1]];
  }
  return obj;
}

// Merge `patch` into `target` (objects recurse, everything else, arrays included, is replaced).
export function deepMerge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value)) {
      if (!isPlainObject(target[key])) target[key] = {};
      deepMerge(target[key], value);
    } else {
      target[key] = Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : value;
    }
  }
  return target;
}

// ---- common options (the only Chart.js options the Guided tab knows about) -------------------
// kind: 'text' | 'bool' | 'select'. get(item) -> current value for the control; set(item, value)
// writes it (an empty/false value removes the keys again so the YAML stays minimal).

export const COMMON_OPTIONS = [
  {
    id: 'title', kind: 'text', label: 'Chart title',
    get: (item) => String(getPath(item, 'options.plugins.title.text') ?? ''),
    set(item, value) {
      if (String(value).trim()) {
        setPath(item, 'options.plugins.title.text', String(value));
        setPath(item, 'options.plugins.title.display', true);
      } else {
        unsetPath(item, 'options.plugins.title.text');
        unsetPath(item, 'options.plugins.title.display');
      }
    }
  },
  {
    id: 'legend', kind: 'select', label: 'Legend', choices: ['', 'top', 'bottom', 'left', 'right', 'hidden'],
    get(item) {
      if (getPath(item, 'options.plugins.legend.display') === false) return 'hidden';
      return String(getPath(item, 'options.plugins.legend.position') ?? '');
    },
    set(item, value) {
      unsetPath(item, 'options.plugins.legend.display');
      unsetPath(item, 'options.plugins.legend.position');
      if (value === 'hidden') setPath(item, 'options.plugins.legend.display', false);
      else if (value) setPath(item, 'options.plugins.legend.position', value);
    }
  },
  {
    id: 'stacked', kind: 'bool', label: 'Stacked',
    get: (item) => getPath(item, 'options.scales.x.stacked') === true && getPath(item, 'options.scales.y.stacked') === true,
    set(item, value) {
      for (const axis of ['x', 'y']) {
        if (value) setPath(item, `options.scales.${axis}.stacked`, true);
        else unsetPath(item, `options.scales.${axis}.stacked`);
      }
    }
  },
  {
    id: 'beginAtZero', kind: 'bool', label: 'Value axis starts at zero',
    get: (item) => getPath(item, 'options.scales.y.beginAtZero') === true,
    set(item, value) {
      if (value) setPath(item, 'options.scales.y.beginAtZero', true);
      else unsetPath(item, 'options.scales.y.beginAtZero');
    }
  },
  {
    id: 'horizontal', kind: 'bool', label: 'Horizontal bars',
    get: (item) => getPath(item, 'options.indexAxis') === 'y',
    set(item, value) {
      if (value) setPath(item, 'options.indexAxis', 'y');
      else unsetPath(item, 'options.indexAxis');
    }
  }
];

// ---- snippets (starting points for the YAML tab; each patch is deep-merged into the item) ------

export const SNIPPETS = [
  { id: 'logScale', label: 'Logarithmic value axis', patch: { options: { scales: { y: { type: 'logarithmic' } } } } },
  { id: 'hideGrid', label: 'Hide gridlines', patch: { options: { scales: { x: { grid: { display: false } }, y: { grid: { display: false } } } } } },
  { id: 'noAnimation', label: 'Turn off animation', patch: { options: { animation: false } } },
  { id: 'smoothLines', label: 'Smooth (curved) lines', patch: { options: { elements: { line: { tension: 0.4 } } } } },
  { id: 'thickLines', label: 'Thick lines and large points', patch: { options: { elements: { line: { borderWidth: 4 }, point: { radius: 6 } } } } },
  { id: 'thinDonut', label: 'Thin doughnut ring', patch: { options: { cutout: '70%' } } },
  { id: 'bigText', label: 'Larger text', patch: { options: { font: { size: 18 } } } },
  { id: 'axisTitles', label: 'Axis titles (edit the text)', patch: { options: { scales: { x: { title: { display: true, text: 'X axis' } }, y: { title: { display: true, text: 'Y axis' } } } } } }
];

// ---- data grid <-> Chart.js data -------------------------------------------------------------
// Grid: { header: [datasetLabel, ...], rows: [[label, v1, v2, ...], ...] }.

// Null when the data is not a plain labels + numeric-array shape (scatter points, etc.).
export function gridFromData(data) {
  if (data === undefined || data === null) return { header: [], rows: [] };
  if (!isPlainObject(data)) return null;
  const labels = Array.isArray(data.labels) ? data.labels : [];
  const datasets = Array.isArray(data.datasets) ? data.datasets : [];
  if (!datasets.every((ds) => isPlainObject(ds) && (ds.data === undefined || (Array.isArray(ds.data) && ds.data.every((v) => v === null || typeof v !== 'object'))))) return null;
  const rowCount = Math.max(labels.length, ...datasets.map((ds) => (ds.data || []).length), 0);
  const rows = [];
  for (let r = 0; r < rowCount; r += 1) {
    rows.push([labels[r] ?? '', ...datasets.map((ds) => (ds.data || [])[r] ?? null)]);
  }
  return { header: datasets.map((ds) => String(ds.label ?? '')), rows };
}

// Write a grid back into `data`, keeping every other key (colours etc.) of the datasets that
// still exist at the same column position.
export function applyGridToData(data, grid) {
  const base = isPlainObject(data) ? data : {};
  const oldSets = Array.isArray(base.datasets) ? base.datasets : [];
  const datasets = grid.header.map((label, col) => {
    const ds = { ...(isPlainObject(oldSets[col]) ? oldSets[col] : {}) };
    ds.label = label;
    ds.data = grid.rows.map((row) => toValue(row[col + 1]));
    if (!String(label).trim()) delete ds.label;
    return ds;
  });
  return { ...base, labels: grid.rows.map((row) => String(row[0] ?? '')), datasets };
}

// Parse pasted spreadsheet text (tab-separated or CSV) into a grid; first row is the header,
// first column the labels. Null when there is no usable table.
export function gridFromText(text) {
  const raw = String(text || '');
  let matrix;
  if (raw.includes('\t')) {
    matrix = raw.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t'));
  } else {
    matrix = parseCSVTable(raw);
  }
  if (!matrix || matrix.length < 2 || Math.max(...matrix.map((r) => r.length)) < 2) return null;
  const width = Math.max(...matrix.map((r) => r.length));
  const pad = (row) => Array.from({ length: width }, (_, i) => String(row[i] ?? '').trim());
  const [head, ...body] = matrix.map(pad);
  return { header: head.slice(1), rows: body.map((r) => [r[0], ...r.slice(1).map((v) => toValue(v))]) };
}
