import { REVEALCHART_BUILDER_DIALOG_HTML } from './builder-dialog-template.js';

// Register Add Content entries shown in the Builder UI.
export function getBuilderTemplates() {
  return [
    {
      label: '📈 Insert Chart Block',
      template: '',
      onSelect: (ctx) => openDataBuilderDialog(ctx, 'chart')
    },
    {
      label: '📋 Insert Table Block',
      template: '',
      onSelect: (ctx) => openDataBuilderDialog(ctx, 'table')
    }
  ];
}

// Open the chart/table block dialog and insert generated YAML into markdown.
// Returns a Promise that resolves when the dialog is closed.
export function openDataBuilderDialog(ctx, initialKind = 'chart') {
// Keep one dialog instance at a time.
const existing = document.getElementById('revealchart-builder-overlay');
if (existing) existing.remove();

// Parse comma-separated user input into trimmed values.
const splitList = (value) =>
  String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

// Parse comma-separated numeric values, preserving non-numeric strings as-is.
const parseNumberList = (value) =>
  splitList(value).map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  });

// Parse "column:value" pairs used for table per-column options.
// Regex purpose: split each token into key/value around the first ":".
const parsePairMap = (value) => {
  const map = {};
  splitList(value).forEach((part) => {
    const m = part.match(/^([^:]+):(.+)$/);
    if (!m) return;
    const key = String(m[1] || '').trim();
    const val = String(m[2] || '').trim();
    if (!key || !val) return;
    map[key] = val;
  });
  return map;
};

// Quote string values for YAML emission in generated snippets.
const quote = (v) => JSON.stringify(String(v));
// Emit compact array syntax for generated YAML.
const formatArray = (items) => `[${items.map((v) => (typeof v === 'number' ? String(v) : quote(v))).join(', ')}]`;

return new Promise((resolve) => {
  const overlay = document.createElement('div');
  overlay.id = 'revealchart-builder-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(7,10,16,.72);z-index:20000;display:flex;align-items:center;justify-content:center;padding:20px;';

  const dialog = document.createElement('div');
  dialog.style.cssText = 'width:min(720px,92vw);max-height:90vh;overflow:auto;background:#161a24;color:#e6e6e6;border:1px solid #303545;border-radius:12px;padding:16px 16px 12px;box-shadow:0 14px 34px rgba(0,0,0,.45);';
  dialog.innerHTML = REVEALCHART_BUILDER_DIALOG_HTML;

  const controlStyle = 'border:1px solid #303545;background:#0f1115;color:#e6e6e6;border-radius:6px;padding:6px 8px;font-size:12px;';
  dialog.querySelectorAll('input, select').forEach((el) => {
    el.style.cssText = controlStyle;
  });
  dialog.querySelectorAll('button').forEach((btn) => {
    const action = btn.getAttribute('data-action');
    const base = 'border:1px solid #303545;background:#1f232d;color:#e6e6e6;border-radius:6px;padding:8px 12px;font-size:12px;cursor:pointer;';
    const primary = 'background:#3b82f6;border-color:#3b82f6;color:#fff;font-weight:600;';
    btn.style.cssText = action === 'insert' ? `${base}${primary}` : base;
  });

  const close = (result) => {
    overlay.remove();
    resolve(result);
  };

  const blockKindEl = dialog.querySelector('[name="blockKind"]');
  const modeEl = dialog.querySelector('[name="mode"]');
  const manualSection = dialog.querySelector('[data-section="manual"]');
  const datasourceSection = dialog.querySelector('[data-section="datasource"]');
  const tableSection = dialog.querySelector('[data-section="table"]');
  // Show/hide sections based on selected block kind + data mode.
  const syncMode = () => {
    const kind = blockKindEl.value;
    const mode = modeEl.value;
    const isChart = kind === 'chart';
    manualSection.style.display = isChart && mode === 'manual' ? '' : 'none';
    datasourceSection.style.display = isChart ? (mode === 'datasource' ? '' : 'none') : '';
    tableSection.style.display = kind === 'table' ? '' : 'none';
    modeEl.disabled = kind === 'table';
    dialog.querySelector('[name="chartType"]').disabled = kind === 'table';
  };
  blockKindEl.value = initialKind === 'table' ? 'table' : 'chart';
  blockKindEl.addEventListener('change', syncMode);
  modeEl.addEventListener('change', syncMode);
  syncMode();

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close({ canceled: true });
    }
  });

  dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => close({ canceled: true }));
  dialog.querySelector('[data-action="help"]')?.addEventListener('click', () => {
    if (!window.electronAPI?.openHandoutView) {
      window.alert('Help is only available in the desktop app.');
      return;
    }
    window.electronAPI.openHandoutView('readme', 'plugins-revealchart-readme.md').catch((err) => {
      console.error(err);
      window.alert(`Failed to open help: ${err.message || err}`);
    });
  });
  dialog.querySelector('[data-action="insert"]').addEventListener('click', () => {
    // Convenience getter for dialog inputs.
    const get = (name) => String((dialog.querySelector(`[name="${name}"]`)?.value || '')).trim();
    const kind = get('blockKind') || 'chart';
    const mode = get('mode');
    const file = get('file');

    if (kind === 'table') {
      if (!file) {
        window.alert('Please enter a CSV file path.');
        return;
      }
      const lines = [
        ':table:',
        `  datasource: ${file}`
      ];
      const tableClass = get('tableClass');
      const tableId = get('tableId');
      const tableDataId = get('tableDataId');
      const tableOverflow = get('tableOverflow');
      const tableHeight = get('tableHeight');
      const includeHeader = get('includeHeader');
      const tableAlign = get('tableAlign');
      const tableFormat = get('tableFormat');
      const tableCurrency = get('tableCurrency');
      const alignColumnsMap = parsePairMap(get('tableAlignColumns'));
      const formatColumnsMap = parsePairMap(get('tableFormatColumns'));
      const summarizeColumnsMap = parsePairMap(get('tableSummarizeColumns'));
      // Emit only non-default table options to keep generated YAML concise.
      const optional = [
        ['class', tableClass],
        ['id', tableId],
        ['dataId', tableDataId],
        ['overflow', tableOverflow],
        ['height', tableHeight],
        ['dataColumns', get('dataColumns')],
        ['dataRows', get('dataRows')],
        ['headerRow', get('headerRow')],
        ['includeHeader', includeHeader],
        ['align', tableAlign],
        ['format', tableFormat],
        ['currency', tableCurrency]
      ];
      optional.forEach(([key, value]) => {
        if (value && !(key === 'align' && value === 'left') && !(key === 'format' && value === 'normal') && !(key === 'currency' && value === 'USD')) {
          lines.push(`  ${key}: ${value}`);
        }
      });
      if (Object.keys(alignColumnsMap).length) {
        lines.push('  alignColumns:');
        Object.entries(alignColumnsMap).forEach(([key, value]) => {
          lines.push(`    ${key}: ${value}`);
        });
      }
      if (Object.keys(formatColumnsMap).length) {
        lines.push('  formatColumns:');
        Object.entries(formatColumnsMap).forEach(([key, value]) => {
          lines.push(`    ${key}: ${value}`);
        });
      }
      if (Object.keys(summarizeColumnsMap).length) {
        lines.push('  summarizeColumns:');
        Object.entries(summarizeColumnsMap).forEach(([key, value]) => {
          lines.push(`    ${key}: ${value}`);
        });
      }
      ctx.insertContent({ markdown: `${lines.join('\n')}\n` });
      close(undefined);
      return;
    }

    const type = get('chartType') || 'line';
    const width = get('width') || '100%';
    const height = get('height') || '400px';
    const lines = [
      ':chart:',
      '  items:',
      `    - type: ${type}`,
      `      height: ${height}`,
      `      width: ${width}`
    ];

    if (mode === 'datasource') {
      if (!file) {
        window.alert('Please enter a CSV file path.');
        return;
      }
      lines.push('      datasource:');
      lines.push(`        file: ${file}`);
      // Emit only datasource keys that are filled in by the user.
      const optional = [
        ['series', get('series')],
        ['labelColumn', get('labelColumn')],
        ['dataColumns', get('dataColumns')],
        ['dataRows', get('dataRows')],
        ['headerRow', get('headerRow')],
        ['labelRow', get('labelRow')]
      ];
      optional.forEach(([key, value]) => {
        if (value) lines.push(`        ${key}: ${value}`);
      });
    } else {
      const labels = splitList(get('labels'));
      const datasetLabel = get('datasetLabel') || 'Dataset 1';
      const datasetValues = parseNumberList(get('datasetValues'));
      lines.push('      data:');
      lines.push(`        labels: ${formatArray(labels.length ? labels : ['Jan', 'Feb', 'Mar'])}`);
      lines.push('        datasets:');
      lines.push(`          - label: ${quote(datasetLabel)}`);
      lines.push(`            data: ${formatArray(datasetValues.length ? datasetValues : [3, 7, 4])}`);
    }

    ctx.insertContent({ markdown: `${lines.join('\n')}\n` });
    close(undefined);
  });

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
});
}
