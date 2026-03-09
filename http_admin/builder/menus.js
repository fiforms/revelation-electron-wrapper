/*
 * Dropdown menus and slide tools picker.
 *
 * Sections:
 * - Slide tools menu
 * - Table picker
 * - Column/slide menus
 */
import {
  trFormat,
  columnMenuBtn,
  columnMenu,
  variantMenuBtn,
  variantMenu,
  presentationMenuBtn,
  presentationMenu,
  slideMenuBtn,
  slideMenu,
  slideToolsBtn,
  slideToolsMenu,
  tablePicker,
  tablePickerGrid,
  tablePickerSize,
  slug,
  mdFile
} from './context.js';
import {
  applyTwoColumnLayout,
  applyInsertToEditor,
  applyReplacementToEditor,
  applyLinePrefix
} from './editor-actions.js';
import { buildTableMarkdown } from './markdown.js';
import { editorEl } from './context.js';

const SMART_PASTE_WORD_LIMIT = 100;
const SMART_PASTE_SLIDE_BREAK = '\n\n---\n\n';

let activeToolsMenu = null;
let activeToolsButton = null;
let tablePickerSelection = { rows: 0, cols: 0 };
let tablePickerInitialized = false;

function countWords(text = '') {
  const matches = String(text || '').match(/\S+/g);
  return matches ? matches.length : 0;
}

function splitLongSlideByWordLimit(text, wordLimit = SMART_PASTE_WORD_LIMIT) {
  const source = String(text || '').trim();
  if (!source) return [];
  const tokens = Array.from(source.matchAll(/\S+/g));
  if (!tokens.length) return [];
  if (tokens.length <= wordLimit) return [source];

  const chunks = [];
  const windowSize = Math.max(10, Math.floor(wordLimit * 0.35));
  let startWord = 0;

  const nextTokenStartsWithDigitAfterNewline = (tokenIndex) => {
    if (tokenIndex <= 0 || tokenIndex >= tokens.length) return false;
    const prev = tokens[tokenIndex - 1];
    const current = tokens[tokenIndex];
    if (!prev || !current) return false;
    const between = source.slice(prev.index + prev[0].length, current.index);
    return /\n+\s*$/.test(between) && /^\d/.test(current[0]);
  };

  const tokenEndsSentence = (tokenIndex) => {
    const token = tokens[tokenIndex]?.[0] || '';
    return /[.!?][)\]"']*$/.test(token);
  };

  while (startWord < tokens.length) {
    const remaining = tokens.length - startWord;
    if (remaining <= wordLimit) {
      const startChar = tokens[startWord].index;
      chunks.push(source.slice(startChar).trim());
      break;
    }

    const targetWord = startWord + wordLimit;
    const minIdx = Math.max(startWord + 1, targetWord - windowSize);
    const maxIdx = Math.min(tokens.length - 1, targetWord + windowSize);

    let chosenCut = targetWord;
    let bestScore = -1;

    for (let idx = minIdx; idx <= maxIdx; idx += 1) {
      let score = 0;
      if (tokenEndsSentence(idx - 1)) score += 3;
      if (nextTokenStartsWithDigitAfterNewline(idx)) score += 4;
      if (idx >= targetWord) score += 1;
      if (score > bestScore) {
        bestScore = score;
        chosenCut = idx;
      }
    }

    const startChar = tokens[startWord].index;
    const endChar = tokens[chosenCut - 1].index + tokens[chosenCut - 1][0].length;
    chunks.push(source.slice(startChar, endChar).trim());
    startWord = chosenCut;
  }

  return chunks.filter(Boolean);
}

function applyDefaultSmartPasteTransform(text) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '';
  const withParagraphSlideBreaks = normalized.replace(/\n{2,}/g, SMART_PASTE_SLIDE_BREAK);
  const rawSlides = withParagraphSlideBreaks
    .split(/\n\s*---\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);

  const finalSlides = [];
  rawSlides.forEach((slideText) => {
    const slideWithHardBreaks = slideText
      .split('\n')
      .map((line) => line.replace(/\s+$/g, ''))
      .join('  \n');

    if (countWords(slideWithHardBreaks) <= SMART_PASTE_WORD_LIMIT) {
      finalSlides.push(slideWithHardBreaks);
      return;
    }
    finalSlides.push(...splitLongSlideByWordLimit(slideWithHardBreaks, SMART_PASTE_WORD_LIMIT));
  });

  return finalSlides.join(SMART_PASTE_SLIDE_BREAK);
}

async function readClipboardText() {
  if (window.electronAPI?.readClipboardText) {
    return String(await window.electronAPI.readClipboardText() || '');
  }
  if (navigator.clipboard?.readText) {
    return String(await navigator.clipboard.readText() || '');
  }
  return '';
}

async function runSmartPastePluginHooks(clipboardText) {
  const plugins = Object.entries(window.RevelationPlugins || {})
    .map(([name, plugin]) => ({ name, plugin, priority: plugin?.priority ?? 999 }))
    .sort((a, b) => a.priority - b.priority);

  let text = String(clipboardText || '');
  let continueDefault = true;

  for (const { name, plugin } of plugins) {
    if (typeof plugin?.onBuilderSmartPaste !== 'function') continue;
    try {
      const result = await plugin.onBuilderSmartPaste({
        text,
        clipboardText: String(clipboardText || ''),
        slug,
        mdFile,
        editorId: 'slide-editor'
      });
      if (typeof result === 'string') {
        text = result;
        continue;
      }
      if (!result || typeof result !== 'object') continue;
      if (typeof result.text === 'string') {
        text = result.text;
      }
      if (typeof result.continueDefault === 'boolean') {
        continueDefault = result.continueDefault;
      }
      if (!continueDefault) break;
    } catch (err) {
      console.warn(`[builder] Smart Paste hook failed for plugin '${name}':`, err);
    }
  }

  return { text, continueDefault };
}

async function runSmartPaste() {
  if (!editorEl) return;
  const clipboardText = await readClipboardText();
  if (!clipboardText) return;
  const { text, continueDefault } = await runSmartPastePluginHooks(clipboardText);
  const output = continueDefault ? applyDefaultSmartPasteTransform(text) : String(text || '');
  if (!output.trim()) return;
  applyReplacementToEditor(
    editorEl,
    'body',
    editorEl.selectionStart ?? 0,
    editorEl.selectionEnd ?? 0,
    output
  );
}

// --- Slide tools menu ---
function renderSlideToolsMenu() {
  if (!slideToolsMenu) return;
  slideToolsMenu.innerHTML = '';
  const addItem = (label, onClick) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'builder-dropdown-item';
    item.textContent = label;
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      Promise.resolve(onClick()).catch((err) => {
        console.error(`[builder] Slide tool '${label}' failed:`, err);
      });
    });
    slideToolsMenu.appendChild(item);
  };

  addItem(tr('Smart Paste'), async () => {
    closeSlideToolsMenu();
    await runSmartPaste();
  });
  addItem(tr('2 column layout'), () => {
    closeSlideToolsMenu();
    applyTwoColumnLayout();
  });
  addItem(tr('Table'), () => {
    closeSlideToolsMenu();
    openTablePicker();
  });
  addItem(tr('Link'), () => {
    closeSlideToolsMenu();
    applyInsertToEditor(editorEl, 'body', '[Example](https://www.example.com)');
  });
  addItem(tr('Named Anchor'), () => 
    applyInsertToEditor(editorEl, 'body', '<a id="slide-name"></a>')
  );
  addItem(tr('YouTube'), () => {
    closeSlideToolsMenu();
    applyInsertToEditor(editorEl, 'body', '![youtube](PASTE LINK)');
  });
  addItem(tr('YouTube (fit)'), () => {
    closeSlideToolsMenu();
    applyInsertToEditor(editorEl, 'body', '![youtube:fit](PASTE LINK)');
  });
  addItem(tr('Website Embed…'), () => {
    closeSlideToolsMenu();
    applyInsertToEditor(editorEl, 'body', '![web](https://example.com)');
  });
  addItem(tr('Heading 1'), () => {
    closeSlideToolsMenu();
    applyLinePrefix(editorEl, 'body', '# ');
  });
  addItem(tr('Heading 2'), () => {
    closeSlideToolsMenu();
    applyLinePrefix(editorEl, 'body', '## ');
  });
  addItem(tr('Heading 3'), () => {
    closeSlideToolsMenu();
    applyLinePrefix(editorEl, 'body', '### ');
  });
  addItem(tr('Blockquote'), () => {
    closeSlideToolsMenu();
    applyLinePrefix(editorEl, 'body', '> ');
  });
  addItem(tr('Ordered List'), () => {
    closeSlideToolsMenu();
    applyInsertToEditor(editorEl, 'body', '1. Item one\n2. Item two\n3. Item three');
  });
  addItem(tr('Unordered List'), () => {
    closeSlideToolsMenu();
    applyInsertToEditor(editorEl, 'body', '- Item one\n- Item two\n- Item three');
  });
  addItem(tr('Code Block'), () => {
    closeSlideToolsMenu();
    applyInsertToEditor(editorEl, 'body', '```\ncode\n```');
  });
  addItem(tr('Fragment') + ' (++)', () => {
    closeSlideToolsMenu();
    applyInsertToEditor(editorEl, 'body', '++', true);
  });
}

function openSlideToolsMenu() {
  if (!slideToolsMenu || !slideToolsBtn) return;
  closeSlideToolsMenu();
  closeTablePicker();
  renderSlideToolsMenu();
  slideToolsMenu.hidden = false;
  slideToolsBtn.classList.add('is-active');
  activeToolsMenu = slideToolsMenu;
  activeToolsButton = slideToolsBtn;
  document.addEventListener('click', handleSlideToolsOutsideClick);
  document.addEventListener('keydown', handleSlideToolsKeydown);
}

function closeSlideToolsMenu() {
  if (!activeToolsMenu || !activeToolsButton) return;
  activeToolsMenu.hidden = true;
  activeToolsButton.classList.remove('is-active');
  document.removeEventListener('click', handleSlideToolsOutsideClick);
  document.removeEventListener('keydown', handleSlideToolsKeydown);
  activeToolsMenu = null;
  activeToolsButton = null;
}

function handleSlideToolsOutsideClick(event) {
  if (!activeToolsMenu || !activeToolsButton) return;
  if (activeToolsMenu.contains(event.target) || activeToolsButton.contains(event.target)) return;
  closeSlideToolsMenu();
}

function handleSlideToolsKeydown(event) {
  if (event.key === 'Escape') {
    closeSlideToolsMenu();
  }
}

// --- Table picker ---
function setTablePickerSelection(rows, cols) {
  tablePickerSelection = { rows, cols };
  if (tablePickerSize) {
    tablePickerSize.textContent = `${rows} x ${cols}`;
  }
  if (!tablePickerGrid) return;
  tablePickerGrid.querySelectorAll('.builder-table-cell').forEach((cell) => {
    const cellRow = Number(cell.dataset.row || 0);
    const cellCol = Number(cell.dataset.col || 0);
    cell.classList.toggle('is-active', cellRow <= rows && cellCol <= cols);
  });
}

function renderTablePickerGrid(maxRows = 8, maxCols = 8) {
  if (!tablePickerGrid || tablePickerInitialized) return;
  const fragment = document.createDocumentFragment();
  for (let row = 1; row <= maxRows; row += 1) {
    for (let col = 1; col <= maxCols; col += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'builder-table-cell';
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.setAttribute('aria-label', trFormat('Select {rows} by {cols} table', { rows: row, cols: col }));
      fragment.appendChild(cell);
    }
  }
  tablePickerGrid.appendChild(fragment);
  tablePickerInitialized = true;
  setTablePickerSelection(0, 0);
}

function openTablePicker() {
  if (!tablePicker) return;
  renderTablePickerGrid();
  tablePicker.hidden = false;
  setTablePickerSelection(0, 0);
  document.addEventListener('click', handleTablePickerOutsideClick);
  document.addEventListener('keydown', handleTablePickerKeydown);
}

function closeTablePicker() {
  if (!tablePicker || tablePicker.hidden) return;
  tablePicker.hidden = true;
  document.removeEventListener('click', handleTablePickerOutsideClick);
  document.removeEventListener('keydown', handleTablePickerKeydown);
}

function handleTablePickerOutsideClick(event) {
  if (!tablePicker || tablePicker.hidden) return;
  if (tablePicker.contains(event.target) || slideToolsBtn?.contains(event.target)) return;
  closeTablePicker();
}

function handleTablePickerKeydown(event) {
  if (event.key === 'Escape') {
    closeTablePicker();
  }
}

// --- Column/slide menus ---
function openColumnMenu() {
  if (!columnMenu || !columnMenuBtn) return;
  columnMenu.hidden = false;
  columnMenuBtn.classList.add('is-active');
  document.addEventListener('click', handleColumnMenuOutsideClick);
  document.addEventListener('keydown', handleColumnMenuKeydown);
}

function closeColumnMenu() {
  if (!columnMenu || !columnMenuBtn) return;
  columnMenu.hidden = true;
  columnMenuBtn.classList.remove('is-active');
  document.removeEventListener('click', handleColumnMenuOutsideClick);
  document.removeEventListener('keydown', handleColumnMenuKeydown);
}

function handleColumnMenuOutsideClick(event) {
  if (!columnMenu || !columnMenuBtn) return;
  if (columnMenu.contains(event.target) || columnMenuBtn.contains(event.target)) return;
  closeColumnMenu();
}

function handleColumnMenuKeydown(event) {
  if (event.key === 'Escape') {
    closeColumnMenu();
  }
}

function openPresentationMenu() {
  if (!presentationMenu || !presentationMenuBtn) return;
  presentationMenu.hidden = false;
  presentationMenuBtn.classList.add('is-active');
  document.addEventListener('click', handlePresentationMenuOutsideClick);
  document.addEventListener('keydown', handlePresentationMenuKeydown);
}

function openVariantMenu() {
  if (!variantMenu || !variantMenuBtn) return;
  variantMenu.hidden = false;
  variantMenuBtn.classList.add('is-active');
  document.addEventListener('click', handleVariantMenuOutsideClick);
  document.addEventListener('keydown', handleVariantMenuKeydown);
}

function closeVariantMenu() {
  if (!variantMenu || !variantMenuBtn) return;
  variantMenu.hidden = true;
  variantMenuBtn.classList.remove('is-active');
  document.removeEventListener('click', handleVariantMenuOutsideClick);
  document.removeEventListener('keydown', handleVariantMenuKeydown);
}

function handleVariantMenuOutsideClick(event) {
  if (!variantMenu || !variantMenuBtn) return;
  if (variantMenu.contains(event.target) || variantMenuBtn.contains(event.target)) return;
  closeVariantMenu();
}

function handleVariantMenuKeydown(event) {
  if (event.key === 'Escape') {
    closeVariantMenu();
  }
}

function closePresentationMenu() {
  if (!presentationMenu || !presentationMenuBtn) return;
  presentationMenu.hidden = true;
  presentationMenuBtn.classList.remove('is-active');
  document.removeEventListener('click', handlePresentationMenuOutsideClick);
  document.removeEventListener('keydown', handlePresentationMenuKeydown);
}

function handlePresentationMenuOutsideClick(event) {
  if (!presentationMenu || !presentationMenuBtn) return;
  if (presentationMenu.contains(event.target) || presentationMenuBtn.contains(event.target)) return;
  closePresentationMenu();
}

function handlePresentationMenuKeydown(event) {
  if (event.key === 'Escape') {
    closePresentationMenu();
  }
}

function openSlideMenu() {
  if (!slideMenu || !slideMenuBtn) return;
  slideMenu.hidden = false;
  slideMenuBtn.classList.add('is-active');
  document.addEventListener('click', handleSlideMenuOutsideClick);
  document.addEventListener('keydown', handleSlideMenuKeydown);
}

function closeSlideMenu() {
  if (!slideMenu || !slideMenuBtn) return;
  slideMenu.hidden = true;
  slideMenuBtn.classList.remove('is-active');
  document.removeEventListener('click', handleSlideMenuOutsideClick);
  document.removeEventListener('keydown', handleSlideMenuKeydown);
}

function handleSlideMenuOutsideClick(event) {
  if (!slideMenu || !slideMenuBtn) return;
  if (slideMenu.contains(event.target) || slideMenuBtn.contains(event.target)) return;
  closeSlideMenu();
}

function handleSlideMenuKeydown(event) {
  if (event.key === 'Escape') {
    closeSlideMenu();
  }
}

function handleTablePickerGridClick(event) {
  const cell = event.target.closest('.builder-table-cell');
  if (!cell) return;
  event.preventDefault();
  event.stopPropagation();
  const rows = Number(cell.dataset.row || 0);
  const cols = Number(cell.dataset.col || 0);
  if (rows <= 0 || cols <= 0) return;
  const tableMarkdown = buildTableMarkdown(rows, cols);
  applyInsertToEditor(editorEl, 'body', tableMarkdown);
  closeTablePicker();
}

function handleTablePickerGridMove(event) {
  const cell = event.target.closest('.builder-table-cell');
  if (!cell) return;
  const rows = Number(cell.dataset.row || 0);
  const cols = Number(cell.dataset.col || 0);
  setTablePickerSelection(rows, cols);
}

function handleTablePickerCancel(event) {
  event.preventDefault();
  event.stopPropagation();
  closeTablePicker();
}

export {
  openSlideToolsMenu,
  closeSlideToolsMenu,
  openTablePicker,
  closeTablePicker,
  openColumnMenu,
  closeColumnMenu,
  openVariantMenu,
  closeVariantMenu,
  openPresentationMenu,
  closePresentationMenu,
  openSlideMenu,
  closeSlideMenu,
  handleTablePickerGridClick,
  handleTablePickerGridMove,
  handleTablePickerCancel
};
