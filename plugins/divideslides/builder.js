// Builder extension: Divide Slides
// Adds a toolbar action that opens an options dialog, then splits long
// slides (by line count and/or word count) into multiple slides.

const DEFAULT_MAX_LINES = 4;

// Inline colon macros (:hide:, :credits:, :countdown:, custom macros, ...)
const COLON_MACRO_RE = /^\s*:[A-Za-z0-9_]+(?::.*)?:\s*$/;
// Sticky curly-brace macros ({{transition}}, {{attrib:...}}, custom macros, ...)
const CURLY_MACRO_RE = /^\s*\{\{[A-Za-z0-9_]+(?::[^}]+)?\}\}\s*$/;
// Attribution / AI-disclosure meta lines
const ATTRIB_OR_AI_RE = /^\s*:(ATTRIB|AI):/i;

// Lines that are structural/special rather than prose: images/media,
// table rows, raw HTML. Never word-split these, even under a macro-free slide.
const IMAGE_LINE_RE = /^\s*!\[/;
const TABLE_ROW_RE = /^\s*\|/;
const HTML_LINE_RE = /^\s*<[a-zA-Z!/]/;

function stripHardBreak(line) {
  return String(line || '').replace(/ {2,}$/, '').replace(/\\$/, '');
}

function getLineHardBreak(line) {
  const text = String(line || '');
  const spaces = text.match(/ {2,}$/);
  if (spaces) return spaces[0];
  return /\\$/.test(text) ? '\\' : '';
}

function lineHasMacro(line) {
  return COLON_MACRO_RE.test(line) || CURLY_MACRO_RE.test(line) || ATTRIB_OR_AI_RE.test(line);
}

function isSpecialLine(line) {
  return IMAGE_LINE_RE.test(line) || TABLE_ROW_RE.test(line) || HTML_LINE_RE.test(line) || lineHasMacro(line);
}

function slideHasMacro(slide) {
  const lines = `${slide.top || ''}\n${slide.body || ''}`.split('\n');
  return lines.some(lineHasMacro);
}

function isStandaloneItalicLine(line) {
  const text = stripHardBreak(line).trim();
  if (!text) return false;
  return /^_([^\s_](?:[^_]*?[^\s_])?)_$/.test(text) || /^\*([^\s*](?:[^*]*?[^\s*])?)\*$/.test(text);
}

function countWords(line) {
  const text = stripHardBreak(line).trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function endsWithTerminalPunctuation(line) {
  const text = stripHardBreak(line).trim();
  return /[.!?;]$/.test(text);
}

// --- Line grouping ---

// Walk the content lines, closing a group whenever the next line would push
// it past maxLines or maxWords (whichever limit is hit first).
function greedyBoundaries(contentLines, maxLines, maxWords) {
  const boundaries = [0];
  let lines = 0;
  let words = 0;
  contentLines.forEach((line, i) => {
    const w = countWords(line);
    const exceedsLines = lines >= maxLines;
    const exceedsWords = maxWords > 0 && lines > 0 && (words + w) > maxWords;
    if (exceedsLines || exceedsWords) {
      boundaries.push(i);
      lines = 0;
      words = 0;
    }
    lines += 1;
    words += w;
  });
  boundaries.push(contentLines.length);
  return boundaries;
}

// If the final group is a single dangling line, rebalance it with the group
// before it so a 5-line slide splits 3+2 instead of 4+1.
function avoidOrphanBoundaries(boundaries) {
  const n = boundaries.length;
  if (n < 3) return boundaries;
  const lastSize = boundaries[n - 1] - boundaries[n - 2];
  if (lastSize > 1) return boundaries;
  const start = boundaries[n - 3];
  const end = boundaries[n - 1];
  const total = end - start;
  const base = Math.floor(total / 2);
  const extra = total % 2;
  const next = [...boundaries];
  next[n - 2] = start + base + extra;
  return next;
}

// Nudge each internal boundary back to the nearest line (within its own
// group) that ends in sentence-ending punctuation, so slides break at
// natural pauses instead of a raw line/word cutoff.
function applyNaturalBreaks(boundaries, contentLines) {
  const next = [...boundaries];
  for (let i = 1; i < next.length - 1; i += 1) {
    const groupStart = next[i - 1];
    const groupEnd = next[i];
    let found = -1;
    for (let j = groupEnd - 1; j >= groupStart; j -= 1) {
      if (endsWithTerminalPunctuation(contentLines[j])) {
        found = j;
        break;
      }
    }
    if (found >= 0 && found + 1 !== groupEnd) {
      next[i] = found + 1;
    }
  }
  return next;
}

function materializeGroups(contentLines, boundaries) {
  const groups = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    groups.push(contentLines.slice(boundaries[i], boundaries[i + 1]));
  }
  return groups;
}

// --- Single-line word splitting ---

// Break one line's words into pieces of at most maxWords, preferring to end
// a piece right after a word carrying punctuation (,;:.!?) over a raw word
// cutoff. Only the final piece keeps the original line's hard-break marker
// (trailing double-space or backslash); earlier pieces get their own hard
// break so they still render as separate lines if a later grouping pass
// keeps more than one piece on the same slide.
function splitLineByWords(line, maxWords) {
  const trailingMarker = getLineHardBreak(line);
  const words = stripHardBreak(line).trim().split(/\s+/).filter(Boolean);
  const pieces = [];
  let start = 0;
  while (start < words.length) {
    let end = Math.min(start + maxWords, words.length);
    if (end < words.length) {
      let breakAt = -1;
      for (let i = end - 1; i > start; i -= 1) {
        if (/[,;:.!?]$/.test(words[i])) {
          breakAt = i + 1;
          break;
        }
      }
      if (breakAt > start) end = breakAt;
    }
    pieces.push(words.slice(start, end).join(' '));
    start = end;
  }
  return pieces.map((piece, i) => (i === pieces.length - 1 ? piece + trailingMarker : `${piece}  `));
}

// Replace any prose line whose own word count exceeds maxWords with several
// shorter lines. Leaves code fences, images, macros, table rows and raw HTML
// untouched since splitting those would corrupt them.
function expandLongLines(contentLines, maxWords) {
  const result = [];
  let insideCode = false;
  let fenceChar = '';
  let fenceLen = 0;
  contentLines.forEach((line) => {
    const fence = String(line || '').match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1];
      if (!insideCode) {
        insideCode = true;
        fenceChar = marker[0];
        fenceLen = marker.length;
      } else if (marker[0] === fenceChar && marker.length >= fenceLen) {
        insideCode = false;
      }
      result.push(line);
      return;
    }
    if (insideCode || isSpecialLine(line) || countWords(line) <= maxWords) {
      result.push(line);
      return;
    }
    result.push(...splitLineByWords(line, maxWords));
  });
  return result;
}

// --- Slide division ---

// Split one slide into multiple slides. Returns [slide] unchanged if it
// contains a macro, has no dividable content, or is already within limits.
function divideSlide(slide, options) {
  if (slideHasMacro(slide)) return [slide];

  const bodyLines = String(slide.body || '').split('\n');
  const headerLines = [];
  let idx = 0;
  while (idx < bodyLines.length && isStandaloneItalicLine(bodyLines[idx])) {
    headerLines.push(bodyLines[idx]);
    idx += 1;
  }

  const rawContentLines = bodyLines.slice(idx).filter((line) => line.trim() !== '');
  if (!rawContentLines.length) return [slide];

  const contentLines = options.maxWords > 0
    ? expandLongLines(rawContentLines, options.maxWords)
    : rawContentLines;

  const totalWords = contentLines.reduce((sum, line) => sum + countWords(line), 0);
  const withinLineLimit = contentLines.length <= options.maxLines;
  const withinWordLimit = !options.maxWords || totalWords <= options.maxWords;
  if (withinLineLimit && withinWordLimit) return [slide];

  let boundaries = greedyBoundaries(contentLines, options.maxLines, options.maxWords);
  if (options.avoidOrphans) boundaries = avoidOrphanBoundaries(boundaries);
  if (options.naturalBreaks) boundaries = applyNaturalBreaks(boundaries, contentLines);

  const groups = materializeGroups(contentLines, boundaries);
  if (groups.length <= 1) return [slide];

  return groups.map((lines, i) => ({
    top: i === 0 ? slide.top : '',
    body: (i === 0 && headerLines.length ? [...headerLines, ...lines] : lines).join('\n'),
    notes: i === 0 ? slide.notes : ''
  }));
}

// Apply divideSlide across a column, optionally restricted to a single slide
// index. Tracks where the originally-selected slide ended up.
function divideColumn(column, options, onlyIndex) {
  const restricted = typeof onlyIndex === 'number';
  const result = [];
  let addedCount = 0;
  let newSelectedIndex = 0;

  column.forEach((slide, i) => {
    if (restricted && i !== onlyIndex) {
      result.push(slide);
      return;
    }
    if (i === onlyIndex) newSelectedIndex = result.length;
    const divided = divideSlide(slide, options);
    addedCount += divided.length - 1;
    result.push(...divided);
  });

  return { slides: result, addedCount, newSelectedIndex };
}

// --- Dialog UI ---

function css(parts) {
  return Array.isArray(parts) ? parts.join(';') : parts;
}

function el(tag, styles, props = {}) {
  const node = document.createElement(tag);
  if (styles) node.style.cssText = css(styles);
  Object.assign(node, props);
  return node;
}

function buildLabeledRow(labelText, control) {
  const row = el('label', ['display:flex', 'align-items:center', 'gap:10px', 'margin:0 0 12px', 'font:13px/1.3 sans-serif']);
  const span = el('span', 'flex:1;');
  span.textContent = labelText;
  row.append(span, control);
  return row;
}

function buildDialogForm(host, close) {
  const form = el('form', ['display:flex', 'flex-direction:column', 'min-width:320px']);

  const title = el('h3', 'margin:0 0 14px;');
  title.textContent = 'Divide Slides';
  form.appendChild(title);

  const scopeWrap = el('div', 'margin:0 0 14px; font:13px/1.4 sans-serif;');
  const scopeLegend = el('div', 'margin:0 0 6px; opacity:.85;');
  scopeLegend.textContent = 'Apply to:';
  scopeWrap.appendChild(scopeLegend);

  const scopeColumn = el('input', null, { type: 'radio', name: 'divideslides-scope', value: 'column', checked: true });
  const scopeSlide = el('input', null, { type: 'radio', name: 'divideslides-scope', value: 'slide' });
  const scopeColumnRow = el('label', ['display:flex', 'align-items:center', 'gap:8px', 'margin:0 0 6px']);
  scopeColumnRow.append(scopeColumn, document.createTextNode('All slides in this column'));
  const scopeSlideRow = el('label', ['display:flex', 'align-items:center', 'gap:8px']);
  scopeSlideRow.append(scopeSlide, document.createTextNode('Current slide only'));
  scopeWrap.append(scopeColumnRow, scopeSlideRow);
  form.appendChild(scopeWrap);

  const maxLinesInput = el('input', 'width:70px;', { type: 'number', min: '1', step: '1', value: String(DEFAULT_MAX_LINES) });
  form.appendChild(buildLabeledRow('Maximum lines per slide', maxLinesInput));

  const maxWordsEnable = el('input', null, { type: 'checkbox' });
  const maxWordsInput = el('input', 'width:70px;', { type: 'number', min: '1', step: '1', value: '40', disabled: true });
  maxWordsEnable.addEventListener('change', () => {
    maxWordsInput.disabled = !maxWordsEnable.checked;
  });
  const maxWordsWrap = el('div', ['display:flex', 'align-items:center', 'gap:8px']);
  maxWordsWrap.append(maxWordsEnable, maxWordsInput);
  form.appendChild(buildLabeledRow('Maximum words per slide', maxWordsWrap));

  const naturalBreaksInput = el('input', null, { type: 'checkbox' });
  form.appendChild(buildLabeledRow('Find natural breaks (prefer punctuation)', naturalBreaksInput));

  const avoidOrphansInput = el('input', null, { type: 'checkbox', checked: true });
  form.appendChild(buildLabeledRow('Avoid orphaned lines', avoidOrphansInput));

  const buttonRow = el('div', ['display:flex', 'justify-content:flex-end', 'gap:10px', 'margin-top:6px']);
  const cancelBtn = el('button', null, { type: 'button', className: 'panel-button' });
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => close({ canceled: true }));

  const submitBtn = el('button', null, { type: 'submit', className: 'panel-button' });
  submitBtn.textContent = 'Divide Slides';
  submitBtn.style.cssText += ';background:#2563eb;border-color:#2563eb;color:#fff';

  buttonRow.append(cancelBtn, submitBtn);
  form.appendChild(buttonRow);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const options = {
      maxLines: Math.max(1, parseInt(maxLinesInput.value, 10) || DEFAULT_MAX_LINES),
      maxWords: maxWordsEnable.checked ? Math.max(1, parseInt(maxWordsInput.value, 10) || 0) : 0,
      naturalBreaks: naturalBreaksInput.checked,
      avoidOrphans: avoidOrphansInput.checked
    };
    const scope = scopeSlide.checked ? 'slide' : 'column';
    runDivide(host, scope, options);
    close({ canceled: false });
  });

  return form;
}

function runDivide(host, scope, options) {
  const doc = host.getDocument();
  const selection = host.getSelection();
  const column = doc.stacks[selection.h] || [];
  const onlyIndex = scope === 'slide' ? selection.v : undefined;

  const { slides, addedCount, newSelectedIndex } = divideColumn(column, options, onlyIndex);

  if (!addedCount) {
    host.notify('No slides needed dividing.', 'info');
    return;
  }

  host.transact('Divide Slides', (tx) => {
    tx.replaceColumn(selection.h, slides);
    tx.setSelection({ h: selection.h, v: newSelectedIndex });
  });

  host.notify(`Divide Slides: added ${addedCount} slide${addedCount === 1 ? '' : 's'}.`, 'info');
}

// Opens the options dialog and runs the divide. Always resolves with
// { canceled: true } so the "Content" menu (which awaits this and would
// otherwise treat a non-insertion as a failure) just quietly does nothing
// further — the actual slide mutation happens via host.transact(...) above,
// not through the Content menu's own insert-at-cursor mechanism.
export function openDivideDialog(host = window.RevelationBuilderHost) {
  if (!host) {
    console.error('[divideslides plugin] Builder host is not available.');
    return Promise.resolve({ canceled: true });
  }
  return host.openDialog({
    render({ root, close }) {
      root.appendChild(buildDialogForm(host, close));
    }
  }).then(() => ({ canceled: true }));
}
