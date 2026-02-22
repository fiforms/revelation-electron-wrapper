(function () {
  const LOCAL_DIR = '/revealchart';

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const existing = Array.from(document.querySelectorAll('script')).find(s => s.src === url);
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${url}`)), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = url;
      script.async = false;
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${url}`)), { once: true });
      document.head.appendChild(script);
    });
  }

  window.RevelationPlugins.revealchart = {
    name: 'revealchart',
    context: null,
    _pluginPromise: null,

    init(context) {
      this.context = context;
    },

    async ensureLoaded() {
      if (this._pluginPromise) {
        return this._pluginPromise;
      }

      const localBase = `${this.context.baseURL}${LOCAL_DIR}`;

      this._pluginPromise = (async () => {
        await loadScript(`${localBase}/chart.umd.min.js`);
        await loadScript(`${localBase}/plugin.js`);

        if (!window.RevealChart) {
          throw new Error('RevealChart did not register on window after script load');
        }
      })();

      return this._pluginPromise;
    },

    async getRevealPlugins() {
      await this.ensureLoaded();
      return [window.RevealChart];
    },

    getBuilderTemplates() {
      return [
        {
          label: '📈 Insert Chart Block',
          template: '',
          onSelect: (ctx) => this.openDataBuilderDialog(ctx, 'chart')
        },
        {
          label: '📋 Insert Table Block',
          template: '',
          onSelect: (ctx) => this.openDataBuilderDialog(ctx, 'table')
        }
      ];
    },

    openDataBuilderDialog(ctx, initialKind = 'chart') {
      const existing = document.getElementById('revealchart-builder-overlay');
      if (existing) existing.remove();

      const splitList = (value) =>
        String(value || '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);

      const parseNumberList = (value) =>
        splitList(value).map((v) => {
          const n = Number(v);
          return Number.isFinite(n) ? n : v;
        });
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

      const quote = (v) => JSON.stringify(String(v));
      const formatArray = (items) => `[${items.map((v) => (typeof v === 'number' ? String(v) : quote(v))).join(', ')}]`;

      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.id = 'revealchart-builder-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(7,10,16,.72);z-index:20000;display:flex;align-items:center;justify-content:center;padding:20px;';

        const dialog = document.createElement('div');
        dialog.style.cssText = 'width:min(720px,92vw);max-height:90vh;overflow:auto;background:#161a24;color:#e6e6e6;border:1px solid #303545;border-radius:12px;padding:16px 16px 12px;box-shadow:0 14px 34px rgba(0,0,0,.45);';
        dialog.innerHTML = `
          <h3 style="margin:0 0 12px;">Insert Data Block</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Block Type
              <select name="blockKind"><option value="chart">chart (:chart:)</option><option value="table">table (:table:)</option></select>
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Chart Type
              <select name="chartType"><option>line</option><option>bar</option><option>pie</option><option>doughnut</option><option>radar</option><option>polarArea</option></select>
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Mode
              <select name="mode"><option value="manual">Manual Data</option><option value="datasource">CSV Datasource</option></select>
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Width
              <input name="width" value="100%" placeholder="100%, 600px">
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Height
              <input name="height" value="400px" placeholder="400px, 60vh">
            </label>
          </div>

          <fieldset data-section="manual" style="margin:12px 0 0;border:1px solid #303545;background:#111520;padding:10px;border-radius:8px;">
            <legend style="color:#9aa3b2;padding:0 6px;">Manual Data</legend>
            <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px;color:#c4ccda;">Labels (comma-separated)
              <input name="labels" value="Jan, Feb, Mar">
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px;color:#c4ccda;">Dataset Label
              <input name="datasetLabel" value="Dataset 1">
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Dataset Values (comma-separated)
              <input name="datasetValues" value="3, 7, 4">
            </label>
          </fieldset>

          <fieldset data-section="datasource" style="margin:12px 0 0;border:1px solid #303545;background:#111520;padding:10px;border-radius:8px;display:none;">
            <legend style="color:#9aa3b2;padding:0 6px;">CSV Datasource</legend>
            <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px;color:#c4ccda;">File
              <input name="file" placeholder="attendance.csv">
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Series
                <select name="series"><option value="column-series">column-series</option><option value="row-series">row-series</option></select>
              </label>
              <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Label Column
                <input name="labelColumn" value="A" placeholder="A, C, 1">
              </label>
              <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Data Columns
                <input name="dataColumns" placeholder="B:D or E,F">
              </label>
              <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Data Rows
                <input name="dataRows" placeholder="2:10">
              </label>
              <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Header Row (column-series)
                <input name="headerRow" value="1">
              </label>
              <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Label Row (row-series)
                <input name="labelRow" value="1">
              </label>
            </div>
          </fieldset>

          <fieldset data-section="table" style="margin:12px 0 0;border:1px solid #303545;background:#111520;padding:10px;border-radius:8px;display:none;">
            <legend style="color:#9aa3b2;padding:0 6px;">Table Options</legend>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Class
                <input name="tableClass" value="lighttable" placeholder="lighttable, darktable">
              </label>
              <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Overflow
                <input name="tableOverflow" value="scroll" placeholder="scroll, auto, hidden">
              </label>
              <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Height
                <input name="tableHeight" placeholder="320px, 45vh">
              </label>
              <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Include Header
                <select name="includeHeader"><option value="true">true</option><option value="false">false</option></select>
              </label>
              <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Default Align
                <select name="tableAlign"><option value="left">left</option><option value="center">center</option><option value="right">right</option></select>
              </label>
              <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Default Format
                <select name="tableFormat"><option value="normal">normal</option><option value="currency">currency</option><option value="percentage">percentage</option></select>
              </label>
              <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Currency
                <input name="tableCurrency" value="USD" placeholder="USD">
              </label>
              <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Align Columns
                <input name="tableAlignColumns" placeholder="C:right, D:right">
              </label>
              <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Format Columns
                <input name="tableFormatColumns" placeholder="C:currency, D:percentage">
              </label>
            </div>
          </fieldset>

          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
            <button type="button" data-action="cancel">Cancel</button>
            <button type="button" data-action="insert" style="font-weight:600;">Insert</button>
          </div>
        `;

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
        dialog.querySelector('[data-action="insert"]').addEventListener('click', () => {
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
            const tableOverflow = get('tableOverflow');
            const tableHeight = get('tableHeight');
            const includeHeader = get('includeHeader');
            const tableAlign = get('tableAlign');
            const tableFormat = get('tableFormat');
            const tableCurrency = get('tableCurrency');
            const alignColumnsMap = parsePairMap(get('tableAlignColumns'));
            const formatColumnsMap = parsePairMap(get('tableFormatColumns'));
            const optional = [
              ['class', tableClass],
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
    },

    preprocessMarkdown(markdown, context = {}) {
      const parseYAML = typeof context.parseYAML === 'function' ? context.parseYAML : null;
      if (!parseYAML) {
        return markdown;
      }

      const lines = String(markdown || '').split('\n');
      const out = [];
      let i = 0;

      const leadingSpaces = (value) => {
        const match = String(value || '').match(/^ */);
        return match ? match[0].length : 0;
      };

      const escapeAttr = (value) =>
        String(value)
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

      const normalizeCssSize = (value, fallback) => {
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
      };

      const parseCSVLine = (line) => {
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
      };

      const parseCSVTable = (csvText) => {
        const rows = String(csvText || '')
          .replace(/^\uFEFF/, '')
          .split(/\r?\n/)
          .map((line) => line)
          .filter((line) => String(line).trim().length > 0)
          .map((line) => parseCSVLine(line));
        return rows.length ? rows : null;
      };

      const toValue = (raw) => {
        const text = String(raw ?? '').trim();
        if (text === '') return null;
        const num = Number(text);
        return Number.isFinite(num) ? num : text;
      };

      const columnRefToIndex = (ref) => {
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
      };

      const rowRefToIndex = (ref) => {
        if (typeof ref === 'number' && Number.isFinite(ref)) {
          return Math.max(0, Math.floor(ref) - 1);
        }
        const text = String(ref || '').trim();
        if (!/^\d+$/.test(text)) return null;
        return Math.max(0, Number.parseInt(text, 10) - 1);
      };

      const parseRefList = (input, parser) => {
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
      };

      const getCell = (rows, rowIdx, colIdx) => {
        const row = rows[rowIdx];
        if (!row) return '';
        return row[colIdx] ?? '';
      };

      const escapeHTML = (value) =>
        String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');

      const buildChartDataFromTable = (rows, sourceOptions = {}) => {
        const rowCount = rows.length;
        if (!rowCount) return null;
        const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
        if (maxCols < 2) return null;

        const series = String(sourceOptions.series || 'column-series').trim().toLowerCase();
        const labelColumn = columnRefToIndex(sourceOptions.labelColumn ?? 'A') ?? 0;
        const headerRow = rowRefToIndex(sourceOptions.headerRow ?? 1) ?? 0;
        const labelRow = rowRefToIndex(sourceOptions.labelRow ?? 1) ?? 0;
        const dataColumns = parseRefList(sourceOptions.dataColumns, columnRefToIndex);
        const dataRows = parseRefList(sourceOptions.dataRows, rowRefToIndex);

        if (series === 'row-series') {
          const columnIndexes = (dataColumns || [...Array(maxCols).keys()].filter((idx) => idx !== labelColumn))
            .filter((idx) => idx >= 0 && idx < maxCols);
          const rowIndexes = (dataRows || [...Array(rowCount).keys()].filter((idx) => idx !== labelRow))
            .filter((idx) => idx >= 0 && idx < rowCount);
          const labels = columnIndexes.map((colIdx) => String(getCell(rows, labelRow, colIdx)).trim());
          const datasets = rowIndexes.map((rowIdx) => ({
            label: String(getCell(rows, rowIdx, labelColumn)).trim() || `Row ${rowIdx + 1}`,
            data: columnIndexes.map((colIdx) => toValue(getCell(rows, rowIdx, colIdx)))
          }));
          return { labels, datasets };
        }

        const columnIndexes = (dataColumns || [...Array(maxCols).keys()].filter((idx) => idx !== labelColumn))
          .filter((idx) => idx >= 0 && idx < maxCols);
        const rowIndexes = (dataRows || [...Array(rowCount).keys()].filter((idx) => idx !== headerRow))
          .filter((idx) => idx >= 0 && idx < rowCount);
        const labels = rowIndexes.map((rowIdx) => String(getCell(rows, rowIdx, labelColumn)).trim());
        const datasets = columnIndexes.map((colIdx) => ({
          label: String(getCell(rows, headerRow, colIdx)).trim() || `Column ${colIdx + 1}`,
          data: rowIndexes.map((rowIdx) => toValue(getCell(rows, rowIdx, colIdx)))
        }));
        return { labels, datasets };
      };

      const datasourceCache = new Map();

      const loadCSVDataFromSource = (datasource) => {
        const sourceOptions = (typeof datasource === 'object' && datasource !== null)
          ? datasource
          : { file: datasource };
        const sourcePath = String(sourceOptions.file || sourceOptions.path || sourceOptions.src || '').trim();
        if (!sourcePath) return null;

        let table = datasourceCache.get(sourcePath) || null;
        if (!table) {
          const resolvedURL = new URL(sourcePath, window.location.href).toString();
          try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', resolvedURL, false);
            xhr.send();
            if (xhr.status >= 200 && xhr.status < 300) {
              table = parseCSVTable(xhr.responseText);
              if (table) datasourceCache.set(sourcePath, table);
            } else {
              console.warn(`[revealchart] Failed to load datasource '${sourcePath}' (${xhr.status}).`);
              return null;
            }
          } catch (err) {
            console.warn(`[revealchart] Failed to load datasource '${sourcePath}'.`, err);
            return null;
          }
        }
        if (!table) {
          console.warn(`[revealchart] datasource '${sourcePath}' did not contain a valid CSV table.`);
          return null;
        }
        const parsed = buildChartDataFromTable(table, sourceOptions);
        if (!parsed) {
          console.warn(`[revealchart] datasource '${sourcePath}' could not be mapped into chart data.`);
        }
        return parsed;
      };

      const resolveDatasource = (datasource) => {
        const sourceOptions = (typeof datasource === 'object' && datasource !== null)
          ? datasource
          : { file: datasource };
        const sourcePath = String(sourceOptions.file || sourceOptions.path || sourceOptions.src || '').trim();
        if (!sourcePath) {
          return { sourceOptions, table: null };
        }

        let table = datasourceCache.get(sourcePath) || null;
        if (!table) {
          const resolvedURL = new URL(sourcePath, window.location.href).toString();
          try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', resolvedURL, false);
            xhr.send();
            if (xhr.status >= 200 && xhr.status < 300) {
              table = parseCSVTable(xhr.responseText);
              if (table) datasourceCache.set(sourcePath, table);
            } else {
              console.warn(`[revealchart] Failed to load datasource '${sourcePath}' (${xhr.status}).`);
              return { sourceOptions, table: null };
            }
          } catch (err) {
            console.warn(`[revealchart] Failed to load datasource '${sourcePath}'.`, err);
            return { sourceOptions, table: null };
          }
        }
        if (!table) {
          console.warn(`[revealchart] datasource '${sourcePath}' did not contain a valid CSV table.`);
        }
        return { sourceOptions, table };
      };

      const normalizeItems = (value) => {
        if (Array.isArray(value)) return value;
        if (value && Array.isArray(value.items)) return value.items;
        if (value && typeof value === 'object') return [value];
        return [];
      };

      const normalizeTableItems = (value) => {
        if (Array.isArray(value)) return value;
        if (value && Array.isArray(value.items)) return value.items;
        if (value && typeof value === 'object') return [value];
        return [];
      };

      const normalizeAlign = (value, fallback = 'left') => {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'right' || raw === 'center' || raw === 'left') return raw;
        return fallback;
      };

      const normalizeFormat = (value, fallback = 'normal') => {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'currency' || raw === 'percentage' || raw === 'normal') return raw;
        return fallback;
      };

      const parseColumnOptionMap = (input) => {
        const outMap = {};
        if (!input) return outMap;
        if (Array.isArray(input)) {
          input.forEach((item) => {
            if (!item || typeof item !== 'object') return;
            const colRef = item.column ?? item.col ?? item.key;
            const colIdx = columnRefToIndex(colRef);
            if (colIdx === null) return;
            const val = item.value ?? item.format ?? item.align;
            if (val === undefined || val === null || val === '') return;
            outMap[colIdx] = String(val).trim().toLowerCase();
          });
          return outMap;
        }
        if (typeof input === 'object') {
          Object.entries(input).forEach(([key, val]) => {
            const colIdx = columnRefToIndex(key);
            if (colIdx === null) return;
            if (val === undefined || val === null || val === '') return;
            outMap[colIdx] = String(val).trim().toLowerCase();
          });
          return outMap;
        }
        return outMap;
      };

      const formatTableValue = (rawValue, formatKind, currencyCode = 'USD') => {
        const text = String(rawValue ?? '').trim();
        if (!text) return { text: '', negative: false, kind: formatKind };
        if (formatKind === 'normal') return { text, negative: false, kind: formatKind };

        const num = Number(text);
        if (!Number.isFinite(num)) return { text, negative: false, kind: formatKind };

        if (formatKind === 'currency') {
          const isNegative = num < 0;
          try {
            const absFormatted = new Intl.NumberFormat(undefined, {
              style: 'currency',
              currency: currencyCode || 'USD',
              maximumFractionDigits: 2
            }).format(Math.abs(num));
            return {
              text: isNegative ? `(${absFormatted})` : absFormatted,
              negative: isNegative,
              kind: formatKind
            };
          } catch {
            return { text, negative: isNegative, kind: formatKind };
          }
        }

        if (formatKind === 'percentage') {
          const pct = Math.abs(num) <= 1 ? (num * 100) : num;
          return {
            text: `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(pct)}%`,
            negative: pct < 0,
            kind: formatKind
          };
        }

        return { text, negative: false, kind: formatKind };
      };

      const toCanvasMarkup = (item) => {
        if (!item || typeof item !== 'object') return '';

        const type = String(item.type || 'bar').trim() || 'bar';
        const attrs = [`data-chart="${escapeAttr(type)}"`];
        const config = {};
        const selector = typeof item.selector === 'string' ? item.selector.trim() : '';
        const chartHeight = normalizeCssSize(item.height, '400px');
        const chartWidth = normalizeCssSize(item.width, '100%');

        if (selector.startsWith('#') && selector.length > 1) {
          attrs.push(`id="${escapeAttr(selector.slice(1))}"`);
        } else if (selector.startsWith('.') && selector.length > 1) {
          attrs.push(`class="${escapeAttr(selector.slice(1))}"`);
        }
        attrs.push(`style="display:block;width:${escapeAttr(chartWidth)};height:${escapeAttr(chartHeight)};margin-left:auto;margin-right:auto;"`);

        if (typeof item.src === 'string' && item.src.trim()) {
          attrs.push(`data-chart-src="${escapeAttr(item.src.trim())}"`);
        }
        if (!item.data && item.datasource) {
          const csvData = loadCSVDataFromSource(item.datasource);
          if (csvData) {
            config.data = csvData;
          }
        }
        if (item.data && typeof item.data === 'object') {
          config.data = item.data;
        }
        if (item.options && typeof item.options === 'object') {
          config.options = item.options;
        }

        const configJSON = JSON.stringify(config);
        return [
          `<canvas ${attrs.join(' ')}>`,
          `<!-- ${configJSON} -->`,
          '</canvas>'
        ].join('\n');
      };

      const toTableMarkup = (item) => {
        if (!item || typeof item !== 'object') return '';
        if (!item.datasource) return '';

        const resolved = resolveDatasource(item.datasource);
        const sourceOptions = resolved.sourceOptions || {};
        const rows = resolved.table;
        if (!rows || !rows.length) return '';

        const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
        const allColIndexes = [...Array(maxCols).keys()];
        const selectedCols = parseRefList(sourceOptions.dataColumns ?? item.dataColumns, columnRefToIndex) || allColIndexes;
        const allRowIndexes = [...Array(rows.length).keys()];
        let selectedRows = parseRefList(sourceOptions.dataRows ?? item.dataRows, rowRefToIndex) || allRowIndexes;
        const includeHeader = sourceOptions.includeHeader !== false && item.includeHeader !== false;
        const headerRow = rowRefToIndex(sourceOptions.headerRow ?? item.headerRow ?? 1) ?? 0;

        selectedRows = selectedRows.filter((idx) => idx >= 0 && idx < rows.length);
        const safeCols = selectedCols.filter((idx) => idx >= 0 && idx < maxCols);
        if (includeHeader && headerRow >= 0 && headerRow < rows.length && !selectedRows.includes(headerRow)) {
          selectedRows = [headerRow, ...selectedRows];
        }
        if (!selectedRows.length || !safeCols.length) return '';

        const className = String(item.class || '').trim();
        const tableClassList = ['datatable'];
        if (className) tableClassList.push(className);
        const tableClassAttr = ` class="${escapeAttr(tableClassList.join(' '))}"`;
        const overflow = String(item.overflow || '').trim().toLowerCase();
        const tableHeight = normalizeCssSize(item.height, '');
        const wrapperStyles = [];
        if (tableHeight) wrapperStyles.push(`height:${escapeAttr(tableHeight)}`);
        if (overflow) {
          wrapperStyles.push(`overflow:${escapeAttr(overflow)}`);
        } else if (tableHeight) {
          // If height is constrained, default overflow for usability.
          wrapperStyles.push('overflow:auto');
        }
        const wrapperStart = wrapperStyles.length
          ? `<div class="table-overflow-wrap" style="${wrapperStyles.join(';')};">`
          : '';
        const wrapperEnd = wrapperStyles.length ? '</div>' : '';
        const defaultAlign = normalizeAlign(item.align, 'left');
        const defaultFormat = normalizeFormat(item.format, 'normal');
        const currencyCode = String(item.currency || 'USD').trim().toUpperCase() || 'USD';
        const alignMap = parseColumnOptionMap(item.alignColumns || item.columnAlign || item.alignments);
        const formatMap = parseColumnOptionMap(item.formatColumns || item.columnFormats || item.formats);

        const headerIsFirst = includeHeader && selectedRows[0] === headerRow;
        const bodyRows = headerIsFirst ? selectedRows.slice(1) : selectedRows;

        const resolveAlignClass = (colIdx) => {
          const resolved = normalizeAlign(alignMap[colIdx], defaultAlign);
          return `datatable-align-${resolved}`;
        };

        const resolveFormat = (colIdx) => normalizeFormat(formatMap[colIdx], defaultFormat);

        const headMarkup = headerIsFirst
          ? `<thead><tr>${safeCols.map((colIdx) => `<th class="${resolveAlignClass(colIdx)}">${escapeHTML(getCell(rows, headerRow, colIdx))}</th>`).join('')}</tr></thead>`
          : '';
        const bodyMarkup = bodyRows.map((rowIdx) =>
          `<tr>${safeCols.map((colIdx) => {
            const formatKind = resolveFormat(colIdx);
            const formatted = formatTableValue(getCell(rows, rowIdx, colIdx), formatKind, currencyCode);
            const extraClass = (formatted.negative && formatted.kind === 'currency') ? ' datatable-negative-currency' : '';
            return `<td class="${resolveAlignClass(colIdx)}${extraClass}">${escapeHTML(formatted.text)}</td>`;
          }).join('')}</tr>`
        ).join('');

        return [
          wrapperStart,
          `<table${tableClassAttr}>`,
          headMarkup,
          `<tbody>${bodyMarkup}</tbody>`,
          '</table>',
          wrapperEnd
        ].filter(Boolean).join('\n');
      };

      const parseYamlBlock = (startIndex, markerName) => {
        const markerLine = lines[startIndex];
        const markerMatch = markerLine.match(new RegExp(`^(\\s*):${markerName}:\\s*$`));
        if (!markerMatch) return null;

        const baseIndent = leadingSpaces(markerMatch[1]);
        let j = startIndex + 1;
        const blockLines = [];
        while (j < lines.length) {
          const current = lines[j];
          if (current.trim() === '') {
            blockLines.push(current);
            j += 1;
            continue;
          }
          if (leadingSpaces(current) <= baseIndent) break;
          blockLines.push(current);
          j += 1;
        }

        const nonEmpty = blockLines.filter((v) => v.trim() !== '');
        if (!nonEmpty.length) {
          return {
            parsed: null,
            nextIndex: startIndex + 1,
            blockLines
          };
        }

        const dedent = Math.min(...nonEmpty.map((v) => leadingSpaces(v)));
        const yamlText = blockLines
          .map((v) => (v.trim() === '' ? '' : v.slice(dedent)))
          .join('\n');

        try {
          return {
            parsed: parseYAML(yamlText),
            nextIndex: j,
            blockLines
          };
        } catch (err) {
          console.warn(`[revealchart] Failed to parse :${markerName}: YAML block:`, err);
          return {
            parsed: undefined,
            nextIndex: j,
            blockLines
          };
        }
      };

      while (i < lines.length) {
        const line = lines[i];
        if (!line.match(/^\s*:(chart|table):\s*$/)) {
          out.push(line);
          i += 1;
          continue;
        }

        const chartBlock = parseYamlBlock(i, 'chart');
        if (chartBlock) {
          const parsed = chartBlock.parsed;
          if (parsed === undefined) {
            out.push(line);
            out.push(...chartBlock.blockLines);
            i = chartBlock.nextIndex;
            continue;
          }
          const items = normalizeItems(parsed);
          if (!items.length) {
            out.push(line);
            out.push(...chartBlock.blockLines);
            i = chartBlock.nextIndex;
            continue;
          }
          for (const item of items) {
            const markup = toCanvasMarkup(item);
            if (markup) out.push(markup);
          }
          i = chartBlock.nextIndex;
          continue;
        }

        const tableBlock = parseYamlBlock(i, 'table');
        if (tableBlock) {
          const parsed = tableBlock.parsed;
          if (parsed === undefined) {
            out.push(line);
            out.push(...tableBlock.blockLines);
            i = tableBlock.nextIndex;
            continue;
          }
          const items = normalizeTableItems(parsed);
          if (!items.length) {
            out.push(line);
            out.push(...tableBlock.blockLines);
            i = tableBlock.nextIndex;
            continue;
          }
          for (const item of items) {
            const markup = toTableMarkup(item);
            if (markup) out.push(markup);
          }
          i = tableBlock.nextIndex;
          continue;
        }

        // Should be unreachable because regex guards above.
        if (!line.trim()) {
          out.push(line);
          i += 1;
          continue;
        }
        out.push(line);
        i += 1;
      }

      return out.join('\n');
    }
  };
})();
