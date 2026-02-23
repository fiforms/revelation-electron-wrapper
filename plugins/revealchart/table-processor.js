// Table block renderer for :table: YAML items.
// Kept separate from the main preprocessor to reduce file size and complexity.

// Restrict alignment to known class names.
function normalizeAlign(value, fallback = 'left') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'right' || raw === 'center' || raw === 'left') return raw;
  return fallback;
}

// Restrict formatter to supported kinds.
function normalizeFormat(value, fallback = 'normal') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'currency' || raw === 'percentage' || raw === 'normal') return raw;
  return fallback;
}

// Normalize per-column option objects/arrays into { colIndex: value }.
function parseColumnOptionMap(input, columnRefToIndex) {
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
}

// Format a table cell according to configured formatting mode.
function formatTableValue(rawValue, formatKind, currencyCode = 'USD') {
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
}

// Parse displayed values back to numbers for summary math.
// Regex purpose: /^\((.*)\)$/ converts "(123)" accounting format to negative.
function parseNumericForSummary(rawValue) {
  const text = String(rawValue ?? '').trim();
  if (!text) return null;
  const parenMatch = text.match(/^\((.*)\)$/);
  const normalized = (parenMatch ? `-${parenMatch[1]}` : text)
    .replace(/[$,%\s]/g, '')
    .replace(/,/g, '');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

// Format computed summary numbers consistently with table format mode.
function formatSummaryValue(num, formatKind, currencyCode = 'USD') {
  if (!Number.isFinite(num)) return '';
  if (formatKind === 'normal') {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(num);
  }
  return formatTableValue(String(num), formatKind, currencyCode).text;
}

// Convert one table item config into rendered HTML table markup.
// `deps` keeps shared helpers injectable from markdown-preprocessor.js.
export function toTableMarkup(item, deps) {
  if (!item || typeof item !== 'object') return '';
  if (!item.datasource) return '';

  const {
    resolveDatasource,
    parseRefList,
    columnRefToIndex,
    rowRefToIndex,
    normalizeCssSize,
    escapeAttr,
    escapeHTML,
    getCell
  } = deps;

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
  const tableId = String(item.id || '').trim();
  const tableIdAttr = tableId ? ` id="${escapeAttr(tableId)}"` : '';
  const tableDataId = String(item.dataId || item['data-id'] || '').trim();
  const tableDataIdAttr = tableDataId ? ` data-id="${escapeAttr(tableDataId)}"` : '';
  const tableStyleRaw = String(item.style || '').trim();
  const tableStyleAttr = tableStyleRaw ? ` style="${escapeAttr(tableStyleRaw)}"` : '';
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
  const alignMap = parseColumnOptionMap(item.alignColumns || item.columnAlign || item.alignments, columnRefToIndex);
  const formatMap = parseColumnOptionMap(item.formatColumns || item.columnFormats || item.formats, columnRefToIndex);
  const summarizeMapRaw = parseColumnOptionMap(item.summarizeColumns || item.columnSummaries || item.summaries, columnRefToIndex);

  const headerIsFirst = includeHeader && selectedRows[0] === headerRow;
  const bodyRows = headerIsFirst ? selectedRows.slice(1) : selectedRows;

  // Resolve final CSS alignment class for one column.
  const resolveAlignClass = (colIdx) => {
    const resolved = normalizeAlign(alignMap[colIdx], defaultAlign);
    return `datatable-align-${resolved}`;
  };

  // Resolve final formatter for one column.
  const resolveFormat = (colIdx) => normalizeFormat(formatMap[colIdx], defaultFormat);
  // Resolve optional summary mode for one column.
  const resolveSummaryMode = (colIdx) => {
    const mode = String(summarizeMapRaw[colIdx] || '').trim().toLowerCase();
    if (mode === 'sum' || mode === 'average') return mode;
    return '';
  };

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
  const summaryCols = safeCols.filter((colIdx) => !!resolveSummaryMode(colIdx));
  const summaryLabelCol = summaryCols.length ? safeCols.find((colIdx) => !summaryCols.includes(colIdx)) : null;
  const summaryMarkup = summaryCols.length ? `<tfoot><tr class="datatable-summary-row">${safeCols.map((colIdx) => {
    const summaryMode = resolveSummaryMode(colIdx);
    if (!summaryMode) {
      if (summaryLabelCol === colIdx) {
        return `<td class="${resolveAlignClass(colIdx)} datatable-summary-label">Summary</td>`;
      }
      return `<td class="${resolveAlignClass(colIdx)}"></td>`;
    }
    const numericValues = bodyRows
      .map((rowIdx) => parseNumericForSummary(getCell(rows, rowIdx, colIdx)))
      .filter((v) => Number.isFinite(v));
    if (!numericValues.length) {
      return `<td class="${resolveAlignClass(colIdx)} datatable-summary-cell"></td>`;
    }
    const aggregate = summaryMode === 'average'
      ? (numericValues.reduce((acc, v) => acc + v, 0) / numericValues.length)
      : numericValues.reduce((acc, v) => acc + v, 0);
    const formatKind = resolveFormat(colIdx);
    const display = formatSummaryValue(aggregate, formatKind, currencyCode);
    return `<td class="${resolveAlignClass(colIdx)} datatable-summary-cell">${escapeHTML(display)}</td>`;
  }).join('')}</tr></tfoot>` : '';

  return [
    wrapperStart,
    `<table${tableClassAttr}${tableIdAttr}${tableDataIdAttr}${tableStyleAttr}>`,
    headMarkup,
    `<tbody>${bodyMarkup}</tbody>`,
    summaryMarkup,
    '</table>',
    wrapperEnd
  ].filter(Boolean).join('\n');
}
