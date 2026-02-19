/*
 * Slide/column state operations and list rendering.
 *
 * Sections:
 * - Panel helpers
 * - Slide list rendering/selection
 * - Column markdown mode
 * - Column operations
 * - Slide operations
 * - Preview sync
 * - Content insertion
 */
import {
  trFormat,
  slideListEl,
  topEditorEl,
  editorEl,
  notesEditorEl,
  columnLabel,
  slideCountLabel,
  topMatterIndicatorEl,
  columnMarkdownPanel,
  columnMarkdownEditor,
  columnMarkdownBtn,
  addContentBtn,
  addSlideBtn,
  deleteSlideBtn,
  combineColumnBtn,
  saveBtn,
  slideMenu,
  slideAddMenuItem,
  slideCombineMenuItem,
  slideDeleteMenuItem,
  slideMoveUpMenuItem,
  slideMoveDownMenuItem,
  columnMoveLeftMenuItem,
  columnMoveRightMenuItem,
  state
} from './context.js';
import {
  titleFromSlide,
  hasTopMatterContent,
  createEmptySlide,
  splitByMarkerLines,
  parseSlide,
  buildSlide,
  sanitizeStacks,
  getNoteSeparatorFromFrontmatter
} from './markdown.js';
import { markDirty, setStatus } from './app-state.js';
import { schedulePreviewUpdate, updatePreview, cancelPreviewUpdateTimer } from './preview.js';
import { closeAddContentMenu } from './content.js';

// --- Panel helpers ---
function getPanelByName(name) {
  return document.querySelector(`.panel-collapsible[data-panel="${name}"]`);
}

function expandPanel(panel) {
  if (!panel) return;
  panel.classList.remove('is-collapsed');
  const toggle = panel.querySelector('.panel-toggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', 'true');
  }
}

function expandSlidesPanel() {
  expandPanel(getPanelByName('slides-in-column'));
}

function expandTopMatterPanel() {
  const panel = getPanelByName('top-matter');
  if (!panel) return;
  const details = panel.querySelector('details');
  if (details) {
    details.open = true;
  }
  expandPanel(panel);
}

function updateTopMatterIndicator() {
  if (!topMatterIndicatorEl) return;
  const { h, v } = state.selected;
  const slide = state.stacks[h]?.[v];
  const isActive = hasTopMatterContent(slide?.top || '');
  topMatterIndicatorEl.classList.toggle('is-active', isActive);
}

function updateColumnMoveMenuItems() {
  if (!columnMoveLeftMenuItem || !columnMoveRightMenuItem) return;
  const maxH = Math.max(state.stacks.length - 1, 0);
  const isDisabled = state.columnMarkdownMode;
  columnMoveLeftMenuItem.classList.toggle('is-disabled', isDisabled || state.selected.h <= 0);
  columnMoveRightMenuItem.classList.toggle('is-disabled', isDisabled || state.selected.h >= maxH);
}

function updateSlideMenuItems() {
  if (!slideMenu) return;
  const { h, v } = state.selected;
  const column = state.stacks[h] || [];
  const isDisabled = state.columnMarkdownMode;
  const canMoveUp = v > 0;
  const canMoveDown = v < column.length - 1;

  if (slideAddMenuItem) slideAddMenuItem.classList.toggle('is-disabled', isDisabled);
  if (slideDeleteMenuItem) slideDeleteMenuItem.classList.toggle('is-disabled', isDisabled);
  if (slideMoveUpMenuItem) slideMoveUpMenuItem.classList.toggle('is-disabled', isDisabled || !canMoveUp);
  if (slideMoveDownMenuItem) slideMoveDownMenuItem.classList.toggle('is-disabled', isDisabled || !canMoveDown);

  if (slideCombineMenuItem) {
    const label = v === 0 ? '🖇️ ' + tr('Combine Columns') : '📎 ' + tr('Break Column');
    slideCombineMenuItem.textContent = label;
    slideCombineMenuItem.classList.toggle('is-disabled', isDisabled || (v === 0 && h === 0));
  }
}

function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (target.getAttribute('type') || '').toLowerCase();
    return type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit' && type !== 'reset';
  }
  return false;
}

// --- Slide list rendering/selection ---
function renderSlideList() {
  // wait for window.translations to be ready
  if(window.translationsources && window.translationsources.length > 0) {
    setTimeout(renderSlideList, 100);
    return;
  }
  slideListEl.innerHTML = '';
  const hIndex = state.selected.h;
  const column = state.stacks[hIndex] || [];
  const total = Math.max(column.length, 0);
  const current = Math.min(state.selected.v + 1, total || 1);
  if (slideCountLabel) {
    slideCountLabel.textContent = trFormat('({current} of {total})', {
      current,
      total: total || 1
    });
  }
  column.forEach((slide, vIndex) => {
    const item = document.createElement('div');
    item.className = 'slide-item';
    if (state.selected.v === vIndex) {
      item.classList.add('active');
    }

    const id = document.createElement('div');
    id.className = 'slide-id';
    id.textContent = `V${vIndex + 1}`;

    const title = document.createElement('div');
    title.className = 'slide-title';
    title.textContent = titleFromSlide(slide.body || '');

    if (hasTopMatterContent(slide.top)) {
      const indicator = document.createElement('span');
      indicator.className = 'slide-top-indicator';
      indicator.textContent = '📌';
      id.appendChild(indicator);
    }

    item.appendChild(id);
    item.appendChild(title);
    item.addEventListener('click', () => selectSlide(hIndex, vIndex));

    slideListEl.appendChild(item);
  });
  updateColumnLabel();
  updateColumnSplitButton();
  updateColumnMarkdownButton();
  updateTopMatterIndicator();
  updateColumnMoveMenuItems();
  updateSlideMenuItems();
}

function selectSlide(hIndex, vIndex) {
  const maxH = Math.max(state.stacks.length - 1, 0);
  const safeH = Math.min(Math.max(hIndex, 0), maxH);
  const column = state.stacks[safeH] || [createEmptySlide()];
  const maxV = Math.max(column.length - 1, 0);
  const safeV = Math.min(Math.max(vIndex, 0), maxV);
  state.selected = { h: hIndex, v: vIndex };
  state.selected.h = safeH;
  state.selected.v = safeV;
  const slide = state.stacks[safeH][safeV] || createEmptySlide();
  topEditorEl.value = slide.top || '';
  editorEl.value = slide.body || '';
  notesEditorEl.value = slide.notes || '';
  renderSlideList();
  updateTopMatterIndicator();
  syncPreviewToEditor();
}

function updateColumnLabel() {
  const total = Math.max(state.stacks.length, 1);
  const current = Math.min(state.selected.h + 1, total);
  columnLabel.textContent = trFormat('Column {current} of {total}', { current, total });
}

function updateColumnSplitButton() {
  if (!combineColumnBtn) return;
  const { h, v } = state.selected;
  if (v === 0) {
    combineColumnBtn.textContent = '🖇️ ' + tr('Combine Columns');
    combineColumnBtn.disabled = h === 0;
    combineColumnBtn.title =
      h === 0 ? tr('Already at the first column.') : tr('Merge this column into the previous column.');
  } else {
    combineColumnBtn.textContent = '📎 ' + tr('Break Column');
    combineColumnBtn.disabled = false;
    combineColumnBtn.title = tr('Start a new column at this slide.');
  }
}

function updateColumnMarkdownButton() {
  if (!columnMarkdownBtn) return;
  if (state.columnMarkdownMode) {
    columnMarkdownBtn.textContent = '👁️';
    columnMarkdownBtn.title = tr('Return to slide editor.');
  } else {
    columnMarkdownBtn.textContent = '{ }';
    columnMarkdownBtn.title = tr('Edit this column as raw markdown.');
  }
}

// --- Column markdown mode ---
function applyColumnMarkdownMode() {
  const isActive = state.columnMarkdownMode;
  document.body.classList.toggle('is-column-md-mode', isActive);
  if (columnMarkdownPanel) {
    columnMarkdownPanel.hidden = !isActive;
  }
  updateColumnMarkdownButton();
  const toggleButtons = [
    addContentBtn,
    addSlideBtn,
    deleteSlideBtn,
    combineColumnBtn
  ];
  toggleButtons.forEach((btn) => {
    if (!btn) return;
    btn.disabled = isActive;
  });
  if (isActive) {
    closeAddContentMenu();
  }
  if (saveBtn) {
    saveBtn.textContent = state.dirty ? tr('Save Now') : tr('Already Saved');
    saveBtn.disabled = !state.dirty;
  }
}

function getColumnMarkdown(hIndex) {
  const column = state.stacks[hIndex] || [createEmptySlide()];
  const joinerV = '\n\n---\n\n';
  return column.map((slide) => buildSlide(slide)).join(joinerV);
}

function parseColumnMarkdown(markdown) {
  if (!markdown || typeof markdown !== 'string') return [createEmptySlide()];
  const trimmed = markdown.trim();
  if (!trimmed) return [createEmptySlide()];
  const noteSeparator = getNoteSeparatorFromFrontmatter(state.frontmatter || '');
  return splitByMarkerLines(markdown, '---').map((slide) => parseSlide(slide, noteSeparator));
}

function enterColumnMarkdownMode() {
  if (state.columnMarkdownMode || !columnMarkdownEditor) return;
  state.columnMarkdownMode = true;
  state.columnMarkdownColumn = state.selected.h;
  columnMarkdownEditor.value = getColumnMarkdown(state.columnMarkdownColumn);
  cancelPreviewUpdateTimer();
  applyColumnMarkdownMode();
  columnMarkdownEditor.focus();
  setStatus(tr('Column markdown mode enabled. Preview updates are paused.'));
}

function applyCurrentColumnMarkdown() {
  if (!state.columnMarkdownMode || !columnMarkdownEditor) return;
  const targetH = state.columnMarkdownColumn;
  const parsedSlides = parseColumnMarkdown(columnMarkdownEditor.value);
  state.stacks[targetH] = parsedSlides.length ? parsedSlides : [createEmptySlide()];
  markDirty();
}

function setColumnMarkdownColumn(nextH, { focusEditor = true, syncPreview = true } = {}) {
  if (!state.columnMarkdownMode || !columnMarkdownEditor) return;
  applyCurrentColumnMarkdown();
  state.columnMarkdownColumn = nextH;
  columnMarkdownEditor.value = getColumnMarkdown(nextH);
  selectSlide(nextH, 0);
  if (syncPreview && state.previewReady) {
    const deck = getPreviewDeck();
    const current = deck?.getIndices ? deck.getIndices() : { h: 0, v: 0 };
    if (deck && (current.h !== nextH || current.v !== 0)) {
      try {
        deck.slide(nextH, 0);
      } catch (err) {
        console.warn('Failed to navigate preview column in markdown mode:', err);
      }
    }
  }
  if (focusEditor) {
    columnMarkdownEditor.focus();
  }
}

function addColumnInMarkdownMode() {
  if (!state.columnMarkdownMode) return;
  applyCurrentColumnMarkdown();
  const insertAt = state.columnMarkdownColumn + 1;
  state.stacks.splice(insertAt, 0, [createEmptySlide()]);
  state.columnMarkdownColumn = insertAt;
  columnMarkdownEditor.value = getColumnMarkdown(insertAt);
  selectSlide(insertAt, 0);
  renderSlideList();
  markDirty();
  columnMarkdownEditor.focus();
}

function deleteColumnInMarkdownMode() {
  if (!state.columnMarkdownMode) return;
  applyCurrentColumnMarkdown();
  if (state.stacks.length === 1) {
    state.stacks[0] = [createEmptySlide()];
    state.columnMarkdownColumn = 0;
    columnMarkdownEditor.value = getColumnMarkdown(0);
    selectSlide(0, 0);
    renderSlideList();
    markDirty();
    columnMarkdownEditor.focus();
    return;
  }
  state.stacks.splice(state.columnMarkdownColumn, 1);
  const nextH = Math.min(state.columnMarkdownColumn, state.stacks.length - 1);
  state.columnMarkdownColumn = nextH;
  columnMarkdownEditor.value = getColumnMarkdown(nextH);
  selectSlide(nextH, 0);
  renderSlideList();
  markDirty();
  columnMarkdownEditor.focus();
}

function exitColumnMarkdownMode() {
  if (!state.columnMarkdownMode || !columnMarkdownEditor) return;
  const targetH = state.columnMarkdownColumn;
  applyCurrentColumnMarkdown();
  state.columnMarkdownMode = false;
  applyColumnMarkdownMode();
  selectSlide(targetH, 0);
  renderSlideList();
  markDirty();
  updatePreview().catch((err) => {
    console.error(err);
    setStatus(trFormat('Preview update failed: {message}', { message: err.message }));
  });
}

// --- Column operations ---
function goToColumn(targetH) {
  const maxH = Math.max(state.stacks.length - 1, 0);
  const nextH = Math.min(Math.max(targetH, 0), maxH);
  selectSlide(nextH, 0);
}

function moveColumn(delta) {
  if (state.columnMarkdownMode) return;
  const { h, v } = state.selected;
  const targetH = h + delta;
  if (targetH < 0 || targetH >= state.stacks.length) return;
  const temp = state.stacks[h];
  state.stacks[h] = state.stacks[targetH];
  state.stacks[targetH] = temp;
  const targetColumn = state.stacks[targetH] || [];
  const nextV = Math.min(v, Math.max(targetColumn.length - 1, 0));
  selectSlide(targetH, nextV);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

function addColumnAfterCurrent() {
  const { h } = state.selected;
  state.stacks.splice(h + 1, 0, [createEmptySlide()]);
  selectSlide(h + 1, 0);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

function deleteCurrentColumn() {
  const { h } = state.selected;
  if (state.stacks.length === 1) {
    state.stacks[0] = [createEmptySlide()];
    selectSlide(0, 0);
    renderSlideList();
    markDirty();
    schedulePreviewUpdate();
    return;
  }
  state.stacks.splice(h, 1);
  const nextH = Math.min(h, state.stacks.length - 1);
  selectSlide(nextH, 0);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

function combineColumnWithPrevious() {
  const { h, v } = state.selected;
  if (h <= 0 || v !== 0) return;
  const current = state.stacks[h];
  const prev = state.stacks[h - 1];
  if (!current || !prev) return;
  const mergedIndex = prev.length + v;
  state.stacks[h - 1] = [...prev, ...current];
  state.stacks.splice(h, 1);
  selectSlide(h - 1, mergedIndex);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

function breakColumnAtCurrentSlide() {
  const { h, v } = state.selected;
  const column = state.stacks[h];
  if (!column || v <= 0) return;
  const before = column.slice(0, v);
  const after = column.slice(v);
  state.stacks[h] = before;
  state.stacks.splice(h + 1, 0, after);
  selectSlide(h + 1, 0);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

// --- Slide operations ---
function addSlideAfterCurrent() {
  const { h, v } = state.selected;
  if (!state.stacks[h]) return;
  state.stacks[h].splice(v + 1, 0, createEmptySlide());
  selectSlide(h, v + 1);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

function moveSlide(delta) {
  if (state.columnMarkdownMode) return;
  const { h, v } = state.selected;
  const column = state.stacks[h];
  if (!column) return;
  const target = v + delta;
  if (target < 0 || target >= column.length) return;
  const temp = column[v];
  column[v] = column[target];
  column[target] = temp;
  selectSlide(h, target);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

function duplicateCurrentSlide() {
  const { h, v } = state.selected;
  if (!state.stacks[h]) return;
  const current = state.stacks[h][v] || createEmptySlide();
  const clone = {
    top: current.top || '',
    body: current.body || '',
    notes: current.notes || ''
  };
  state.stacks[h].splice(v + 1, 0, clone);
  selectSlide(h, v + 1);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

function breakCurrentSlide() {
  if(document.activeElement === editorEl) {
    const { h, v } = state.selected;
    if (!state.stacks[h]) return;
    const current = state.stacks[h][v];
    if (!current) return;
    const newSlide = createEmptySlide();
    newSlide.body = current.body.substring(editorEl.selectionEnd).trim();
    current.body = current.body.substring(0, editorEl.selectionEnd).trim();
    state.stacks[h].splice(v + 1, 0, newSlide);
    selectSlide(h, v + 1);
    renderSlideList();
    markDirty();
    schedulePreviewUpdate();
    editorEl.selectionStart = 0;
    editorEl.selectionEnd = 0;
  }
  else if(document.activeElement === columnMarkdownEditor) {
    const textarea = columnMarkdownEditor;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const before = value.substring(0, start).trimEnd();
    const after = value.substring(end).trimStart();
    const newValue = `${before}\n\n---\n\n${after}`;
    textarea.value = newValue;
    textarea.selectionStart = before.length + 7;
    textarea.selectionEnd = before.length + 7;
    textarea.focus();
    markDirty();
  }

}

function addMarkdownLineBreak() {
  if(document.activeElement !== editorEl && 
     document.activeElement !== notesEditorEl && 
     document.activeElement !== columnMarkdownEditor && 
     document.activeElement !== topEditorEl) {
        return false;
  }
  const { h, v } = state.selected;
  if (!state.stacks[h]) return;
  const current = state.stacks[h][v];
  if (!current) return;
  const textarea = document.activeElement;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const before = value.substring(0, start).trimEnd();
  const after = value.substring(end).trimStart();
  const newValue = `${before}  \n${after}`;
  textarea.value = newValue;
  if(textarea === editorEl) {
    current.body = newValue;
  } else if(textarea === notesEditorEl) {
    current.notes = newValue;
  } else if(textarea === topEditorEl) {
    current.top = newValue;
  }
  textarea.selectionStart = before.length + 3;
  textarea.selectionEnd = before.length + 3;
  textarea.focus();
  markDirty();
  schedulePreviewUpdate();
  return true;
}

function deleteCurrentSlide() {
  const { h, v } = state.selected;
  if (!state.stacks[h]) return;
  if (state.stacks.length === 1 && state.stacks[h].length === 1) {
    state.stacks[0][0] = createEmptySlide();
    selectSlide(0, 0);
    renderSlideList();
    markDirty();
    schedulePreviewUpdate();
    return;
  }
  state.stacks[h].splice(v, 1);
  if (state.stacks[h].length === 0) {
    state.stacks.splice(h, 1);
  }
  const nextH = Math.min(h, state.stacks.length - 1);
  const nextV = Math.min(v, state.stacks[nextH].length - 1);
  selectSlide(nextH, nextV);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

function handleAddColumn() {
  if (state.columnMarkdownMode) {
    addColumnInMarkdownMode();
  } else {
    addColumnAfterCurrent();
  }
}

function handleDeleteColumn() {
  if (state.columnMarkdownMode) {
    deleteColumnInMarkdownMode();
  } else {
    deleteCurrentColumn();
  }
}

// --- Preview sync ---
function syncPreviewToEditor() {
  if (state.columnMarkdownMode) return;
  if (!state.previewReady || state.previewSyncing) return;
  const deck = getPreviewDeck();
  if (!deck) return;
  const { h, v } = state.selected;
  const current = deck.getIndices ? deck.getIndices() : { h: 0, v: 0 };
  if (current.h === h && current.v === v) return;
  state.previewSyncing = true;
  try {
    deck.slide(h, v);
  } catch (err) {
    console.warn('Failed to sync preview to editor:', err);
  } finally {
    setTimeout(() => {
      state.previewSyncing = false;
    }, 0);
  }
}

function getPreviewDeck() {
  return window.__builderPreviewDeck || null;
}

// --- Content insertion ---
function insertSlideStacksAtPosition(stacks, insertAt) {
  const cleaned = sanitizeStacks(stacks);
  if (!cleaned.length) return false;
  const targetH = insertAt?.h ?? state.selected.h;
  const targetV = insertAt?.v ?? state.selected.v;
  if (!state.stacks[targetH]) {
    state.stacks[targetH] = [createEmptySlide()];
  }
  const column = state.stacks[targetH];
  const before = column.slice(0, targetV + 1);
  const after = column.slice(targetV + 1);
  const [firstColumn, ...restColumns] = cleaned;
  state.stacks[targetH] = [...before, ...firstColumn, ...after];
  if (restColumns.length) {
    state.stacks.splice(targetH + 1, 0, ...restColumns);
  }
  const insertedIndex = before.length;
  selectSlide(targetH, insertedIndex);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
  return true;
}

export {
  getPanelByName,
  expandPanel,
  expandSlidesPanel,
  expandTopMatterPanel,
  updateTopMatterIndicator,
  updateColumnMoveMenuItems,
  updateSlideMenuItems,
  isEditableTarget,
  renderSlideList,
  selectSlide,
  updateColumnLabel,
  updateColumnSplitButton,
  updateColumnMarkdownButton,
  applyColumnMarkdownMode,
  getColumnMarkdown,
  parseColumnMarkdown,
  enterColumnMarkdownMode,
  applyCurrentColumnMarkdown,
  setColumnMarkdownColumn,
  addColumnInMarkdownMode,
  deleteColumnInMarkdownMode,
  exitColumnMarkdownMode,
  goToColumn,
  moveColumn,
  addColumnAfterCurrent,
  deleteCurrentColumn,
  combineColumnWithPrevious,
  breakColumnAtCurrentSlide,
  addSlideAfterCurrent,
  moveSlide,
  duplicateCurrentSlide,
  breakCurrentSlide,
  addMarkdownLineBreak,
  deleteCurrentSlide,
  handleAddColumn,
  handleDeleteColumn,
  syncPreviewToEditor,
  getPreviewDeck,
  insertSlideStacksAtPosition
};
