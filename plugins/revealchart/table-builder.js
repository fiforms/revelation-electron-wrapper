// plugins/revealchart/table-builder.js  (browser, builder only; lazy-imported by client.js)
// The `:table:` block dialog. openTableDialog() is shared by two callers in client.js:
//   - getBlockTools "Table…" (Rich Builder Animation menu): inserts a new block via
//     ctx.appendToSlideEnd.
//   - onRichMacroEdit: edits an existing `:table:` card through payload.setRaw / remove.
// A table always reads a CSV file, so the Guided tab is: the CSV path, the common table keys
// (TABLE_FIELDS) and a per-column rule list (align / format / summary). The dialog shell (item
// list, Guided/YAML tabs, buttons) is block-dialog.js; anything else is edited on the YAML tab.
// Block text is read and written by table-block.js (needs window.jsyaml from builder.html).
import {
  TABLE_FIELDS, RULE_CHOICES, parseTableBlock, buildTableBlock, defaultTableItem,
  getDatasourceFile, setDatasourceFile, getField, setField, getIncludeHeader, setIncludeHeader,
  columnRules, applyColumnRules
} from './table-block.js';
import { openBlockDialog, el, button, field, control } from './block-dialog.js';

const DEFAULT_LABEL = () => tr('Default');

function renderField(item, def, api) {
  const value = getField(item, def);
  let input;
  if (def.kind === 'select') {
    // A value the list doesn't know (a custom class) is kept as an extra choice.
    const choices = value && !def.choices.includes(value) ? [...def.choices, value] : def.choices;
    input = control('select');
    input.replaceChildren(...choices.map((c) => el('option', { value: c, text: c || DEFAULT_LABEL() })));
  } else {
    input = control('input', { type: 'text', placeholder: def.placeholder || '' });
  }
  input.value = value;
  input.addEventListener(def.kind === 'select' ? 'change' : 'input', () => { setField(item, def, input.value); api.changed(); });
  return field(tr(def.label), input);
}

// Per-column rows: column letter, alignment, format, summary.
function renderRules(item, api) {
  const wrap = el('div', { style: 'margin-top:12px;' });
  const rules = columnRules(item);
  wrap.append(el('div', { text: tr('Column rules'), style: 'color:#9aa3b2;margin-bottom:4px;' }));
  if (!rules) {
    wrap.append(el('div', { style: 'color:#c4ccda;', text: tr('This table writes its column rules in a form the list cannot show. Edit them on the YAML tab.') }));
    return wrap;
  }
  const sync = () => { applyColumnRules(item, rules); api.changed(); };
  const select = (kind, rule) => {
    const sel = control('select');
    sel.replaceChildren(...RULE_CHOICES[kind].map((c) => el('option', { value: c, text: c || DEFAULT_LABEL() })));
    sel.value = rule[kind];
    sel.addEventListener('change', () => { rule[kind] = sel.value; sync(); });
    return sel;
  };
  const rebuild = () => {
    const table = el('table', { style: 'border-collapse:separate;border-spacing:4px;' });
    table.append(el('tr', {}, ...[tr('Column'), tr('Align'), tr('Format'), tr('Summary')].map((t) => el('th', { text: t, style: 'text-align:left;font-weight:normal;color:#8a93a6;' }))));
    rules.forEach((rule, i) => {
      const col = control('input', { type: 'text', value: rule.column, placeholder: 'C' });
      col.style.width = '60px';
      col.addEventListener('input', () => { rule.column = col.value; sync(); });
      table.append(el('tr', {},
        el('td', {}, col), el('td', {}, select('align', rule)), el('td', {}, select('format', rule)), el('td', {}, select('summarize', rule)),
        el('td', {}, button('×', () => { rules.splice(i, 1); sync(); rebuild(); }))));
    });
    wrap.replaceChildren(wrap.firstChild, table, button(tr('Add rule'), () => { rules.push({ column: '', align: '', format: '', summarize: '' }); rebuild(); }, 'margin-top:4px;'));
  };
  rebuild();
  return wrap;
}

function renderGuided(item, api) {
  const file = control('input', { type: 'text', value: getDatasourceFile(item), placeholder: 'attendance.csv' });
  file.addEventListener('input', () => { setDatasourceFile(item, file.value); api.changed(); });
  const header = el('input', { type: 'checkbox', checked: getIncludeHeader(item) });
  header.addEventListener('change', () => { setIncludeHeader(item, header.checked); api.changed(); });
  const objectForm = item.datasource && typeof item.datasource === 'object';

  return [
    field(tr('CSV file'), file),
    el('div', { style: 'color:#8a93a6;margin:4px 0 10px;', text: objectForm
      ? tr('This table uses the object form of datasource; keys inside it override the fields below. Edit them on the YAML tab.')
      : tr('A path relative to the presentation folder, or a full URL.') }),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;align-items:end;' },
      ...TABLE_FIELDS.map((def) => renderField(item, def, api)),
      el('label', { style: 'display:flex;gap:8px;align-items:center;color:#c4ccda;' }, header, tr('First row is a header'))),
    renderRules(item, api)
  ];
}

// Show the dialog. `initial` is { items, shape, extras, indent } from parseTableBlock, or null
// for a new block. Resolves { action: 'apply', block } | { action: 'remove' } | { action: 'cancel' }.
export function openTableDialog(initial) {
  return openBlockDialog({
    overlayId: 'revealchart-table-overlay',
    titleNew: tr('Table'),
    titleEdit: tr('Edit Table'),
    initial,
    meta: initial || { shape: 'items', extras: {}, indent: '' },
    defaultItem: defaultTableItem,
    itemLabel: (item) => getDatasourceFile(item) || tr('(no file)'),
    renderGuided,
    buildBlock: (items, meta) => buildTableBlock(items, window.jsyaml, meta),
    labels: {
      item: tr('Table'),
      add: tr('Add table'),
      remove: tr('Remove table'),
      removeBlock: tr('Remove Table Block'),
      needOne: tr('A block needs at least one table.')
    }
  });
}

// Animation-menu entry: ask for the table, then add the block at the end of the slide.
export async function insertTableBlock(ctx) {
  if (!window.jsyaml) return;
  const result = await openTableDialog(null);
  if (result.action === 'apply') ctx.appendToSlideEnd(result.block);
}

// onRichMacroEdit handler for a `:table:` card. Returns false when the block can't be parsed so
// the host falls back to its plain-text editor.
export async function editTableCard(payload) {
  if (!window.jsyaml) return false;
  const initial = parseTableBlock(payload.raw, window.jsyaml);
  if (!initial) return false;
  const result = await openTableDialog(initial);
  if (result.action === 'apply') payload.setRaw(result.block);
  else if (result.action === 'remove') payload.remove();
  return true;
}
