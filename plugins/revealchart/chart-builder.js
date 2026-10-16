// plugins/revealchart/chart-builder.js  (browser, builder only; lazy-imported by client.js)
// The `:chart:` block dialog. openChartDialog() is shared by two callers in client.js:
//   - getBlockTools "Chart…" (Rich Builder Animation menu): inserts a new block via
//     ctx.appendToSlideEnd.
//   - onRichMacroEdit: edits an existing `:chart:` card through payload.setRaw / remove.
// The dialog shell (item list, Guided/YAML tabs, buttons) is block-dialog.js; this file adds the
// Guided tab (type, size, data grid, COMMON_OPTIONS), the option snippets and a live preview that
// renders the item with Chart.js (loaded through loadChartJs from client.js).
// Block text is read and written by chart-block.js (needs window.jsyaml from builder.html).
import {
  CHART_TYPES, COMMON_OPTIONS, SNIPPETS, parseChartBlock, buildChartBlock, defaultChartItem,
  gridFromData, applyGridToData, gridFromText, deepMerge
} from './chart-block.js';
import { openBlockDialog, el, button, field, control, textBinding } from './block-dialog.js';

const CHARTJS_DOCS = 'https://www.chartjs.org/docs/latest/configuration/';

// Live preview: a canvas inside the dialog's preview box, drawn with Chart.js.
function makePreview(loadChartJs) {
  let chart = null;
  let canvas = null;
  let note = null;
  const destroy = () => { if (chart) { chart.destroy(); chart = null; } };
  const showNote = (box, text) => {
    destroy();
    note.textContent = text;
    note.style.display = 'flex';
    canvas.style.display = 'none';
  };
  return {
    height: 220,
    destroy,
    async render(item, box) {
      if (!canvas) {
        canvas = el('canvas');
        note = el('div', { style: 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;color:#555;text-align:center;padding:12px;' });
        box.append(canvas, note);
      }
      if (!item.data) { showNote(box, item.datasource ? tr('Preview is not available for CSV datasources.') : tr('No data yet.')); return; }
      try {
        const Chart = await loadChartJs();
        destroy();
        const copy = JSON.parse(JSON.stringify(item));
        note.style.display = 'none';
        canvas.style.display = '';
        chart = new Chart(canvas, {
          type: copy.type || 'bar',
          data: copy.data,
          options: { maintainAspectRatio: false, ...(copy.options || {}), animation: false }
        });
      } catch (err) {
        showNote(box, String(err.message || err));
      }
    }
  };
}

// Data grid: first column labels, one column per dataset.
function renderData(item, api) {
  const wrap = el('div');
  if (item.datasource) {
    wrap.append(el('div', { style: 'color:#c4ccda;', text: tr('This chart reads its data from a CSV datasource. Edit it on the YAML tab.') }));
    return wrap;
  }
  const grid = gridFromData(item.data);
  if (!grid) {
    wrap.append(el('div', { style: 'color:#c4ccda;', text: tr('This chart uses a data format the grid cannot show. Edit it on the YAML tab.') }));
    return wrap;
  }
  const sync = () => { item.data = applyGridToData(item.data, grid); api.changed(); };
  const rebuild = () => { wrap.replaceChildren(buildGrid()); };
  const cell = (value, onInput) => {
    const input = control('input', { type: 'text', value: value ?? '' });
    input.style.width = '110px';
    input.addEventListener('input', () => onInput(input.value));
    return input;
  };
  const buildGrid = () => {
    const table = el('table', { style: 'border-collapse:separate;border-spacing:4px;' });
    table.append(el('tr', {},
      el('th', { text: tr('Label'), style: 'text-align:left;font-weight:normal;color:#8a93a6;' }),
      ...grid.header.map((h, c) => el('th', {}, cell(h, (v) => { grid.header[c] = v; sync(); }))),
      el('th', {}, button('+', () => { grid.header.push(`${tr('Dataset')} ${grid.header.length + 1}`); grid.rows.forEach((r) => r.push(null)); sync(); rebuild(); }))
    ));
    grid.rows.forEach((row, r) => {
      table.append(el('tr', {},
        el('td', {}, cell(row[0], (v) => { row[0] = v; sync(); })),
        ...grid.header.map((_, c) => el('td', {}, cell(row[c + 1], (v) => { row[c + 1] = v; sync(); }))),
        el('td', {}, button('×', () => { grid.rows.splice(r, 1); sync(); rebuild(); }))
      ));
    });
    const paste = control('textarea', { rows: 4, placeholder: tr('Paste cells copied from a spreadsheet (first row = dataset names, first column = labels)') });
    paste.style.cssText += 'width:100%;box-sizing:border-box;display:none;margin-top:6px;';
    const importBtn = button(tr('Import pasted data'), () => {
      const parsed = gridFromText(paste.value);
      if (!parsed) { api.setError(tr('Could not read a table from the pasted text.')); return; }
      api.setError('');
      grid.header = parsed.header; grid.rows = parsed.rows;
      sync(); rebuild();
    }, 'display:none;margin-top:6px;');
    const pasteToggle = button(tr('Paste from spreadsheet…'), () => {
      const show = paste.style.display === 'none';
      paste.style.display = show ? '' : 'none';
      importBtn.style.display = show ? '' : 'none';
    });
    return el('div', {}, table,
      el('div', { style: 'display:flex;gap:6px;margin-top:6px;' },
        button(tr('Add row'), () => { grid.rows.push(['', ...grid.header.map(() => null)]); sync(); rebuild(); }), pasteToggle),
      paste, importBtn);
  };
  rebuild();
  return wrap;
}

function renderGuided(item, api) {
  const typeSel = control('select');
  const types = CHART_TYPES.includes(item.type) || !item.type ? CHART_TYPES : [item.type, ...CHART_TYPES];
  typeSel.replaceChildren(...types.map((t) => el('option', { value: t, text: t })));
  typeSel.value = item.type || 'bar';
  typeSel.addEventListener('change', () => { item.type = typeSel.value; api.changed(); });

  const optionControls = COMMON_OPTIONS.map((opt) => {
    if (opt.kind === 'bool') {
      const input = el('input', { type: 'checkbox', checked: !!opt.get(item) });
      input.addEventListener('change', () => { opt.set(item, input.checked); api.changed(); });
      return el('label', { style: 'display:flex;gap:8px;align-items:center;color:#c4ccda;' }, input, tr(opt.label));
    }
    const input = control(opt.kind === 'select' ? 'select' : 'input', opt.kind === 'select' ? {} : { type: 'text' });
    if (opt.kind === 'select') input.replaceChildren(...opt.choices.map((c) => el('option', { value: c, text: c || tr('Default') })));
    input.value = opt.get(item);
    input.addEventListener(opt.kind === 'select' ? 'change' : 'input', () => { opt.set(item, input.value); api.changed(); });
    return field(tr(opt.label), input);
  });

  return [
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;' },
      field(tr('Chart type'), typeSel), field(tr('Width'), textBinding(item, 'width', api, '100%')), field(tr('Height'), textBinding(item, 'height', api, '400px'))),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;align-items:end;' }, ...optionControls),
    renderData(item, api)
  ];
}

// Show the dialog. `initial` is { items, shape, extras, indent } from parseChartBlock, or null
// for a new block. Resolves { action: 'apply', block } | { action: 'remove' } | { action: 'cancel' }.
export function openChartDialog(initial, loadChartJs) {
  return openBlockDialog({
    overlayId: 'revealchart-chart-overlay',
    titleNew: tr('Chart'),
    titleEdit: tr('Edit Chart'),
    initial,
    meta: initial || { shape: 'items', extras: {}, indent: '' },
    defaultItem: defaultChartItem,
    itemLabel: (item) => item.type || 'bar',
    renderGuided,
    buildBlock: (items, meta) => buildChartBlock(items, window.jsyaml, meta),
    snippets: SNIPPETS.map((s) => ({ ...s, label: tr(s.label) })),
    deepMerge,
    docsUrl: CHARTJS_DOCS,
    docsLabel: tr('Chart.js options reference'),
    preview: makePreview(loadChartJs),
    labels: {
      item: tr('Chart'),
      add: tr('Add chart'),
      remove: tr('Remove chart'),
      removeBlock: tr('Remove Chart Block'),
      needOne: tr('A block needs at least one chart.'),
      snippets: tr('Add option snippet…')
    }
  });
}

// Animation-menu entry: ask for the chart, then add the block at the end of the slide.
export async function insertChartBlock(ctx, loadChartJs) {
  if (!window.jsyaml) return;
  const result = await openChartDialog(null, loadChartJs);
  if (result.action === 'apply') ctx.appendToSlideEnd(result.block);
}

// onRichMacroEdit handler for a `:chart:` card. Returns false when the block can't be parsed so
// the host falls back to its plain-text editor.
export async function editChartCard(payload, loadChartJs) {
  if (!window.jsyaml) return false;
  const initial = parseChartBlock(payload.raw, window.jsyaml);
  if (!initial) return false;
  const result = await openChartDialog(initial, loadChartJs);
  if (result.action === 'apply') payload.setRaw(result.block);
  else if (result.action === 'remove') payload.remove();
  return true;
}
