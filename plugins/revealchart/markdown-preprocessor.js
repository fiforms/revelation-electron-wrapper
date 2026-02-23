import {
  normalizeCssSize,
  parseCSVTable,
  toValue,
  columnRefToIndex,
  rowRefToIndex,
  parseRefList,
  getCell,
  escapeHTML
} from './csv-utils.js';
import { toTableMarkup } from './table-processor.js';

// Transform custom :chart: and :table: YAML blocks into runtime HTML markup.
// This runs during markdown preprocessing before Reveal renders slides.
export function preprocessMarkdown(markdown, context = {}) {
  const parseYAML = typeof context.parseYAML === 'function' ? context.parseYAML : null;
  if (!parseYAML) {
    return markdown;
  }

  const lines = String(markdown || '').split('\n');
  const out = [];
  let i = 0;

  // Count indentation used to detect block nesting and dedent YAML.
  const leadingSpaces = (value) => {
    const match = String(value || '').match(/^ */);
    return match ? match[0].length : 0;
  };

  // Escape values written into HTML attributes.
  const escapeAttr = (value) =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  // Build Chart.js-compatible { labels, datasets } from a CSV matrix.
  // Supports both column-series and row-series extraction modes.
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

  // Cache CSV tables by source path so multiple chart/table blocks reuse one fetch.
  const datasourceCache = new Map();

  // Load CSV and convert directly into chart data for :chart: blocks.
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

  // Load CSV but return raw table + normalized source options for :table: blocks.
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

  // Accept flexible YAML shape: array, {items:[...]}, or single object.
  const normalizeItems = (value) => {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.items)) return value.items;
    if (value && typeof value === 'object') return [value];
    return [];
  };

  // Same normalizer for table block items.
  const normalizeTableItems = (value) => {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.items)) return value.items;
    if (value && typeof value === 'object') return [value];
    return [];
  };

  // Convert one chart item config into <canvas> + embedded JSON config comment.
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

  // Parse and dedent the indented YAML block that follows :chart: or :table: marker.
  // Regex purpose:
  // - /^(\\s*):${markerName}:\\s*$/ captures base indentation for the marker line.
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
    // Fast path: copy lines until we hit a recognized block marker.
    // Regex purpose: /^\s*:(chart|table):\s*$/ detects supported block headings.
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
        const markup = toTableMarkup(item, {
          resolveDatasource,
          parseRefList,
          columnRefToIndex,
          rowRefToIndex,
          normalizeCssSize,
          escapeAttr,
          escapeHTML,
          getCell
        });
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
