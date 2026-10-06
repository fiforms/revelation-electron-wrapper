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
import { markDirty, setStatus, setSaveButtonLabel } from './app-state.js';
import { refreshSlideProperties } from './properties.js';
import { updateNotesPeek, setBuilderView } from './layout.js';
import { refreshNotesRich } from './notes-editor.js';
import {
  schedulePreviewUpdate,
  updatePreview,
  cancelPreviewUpdateTimer,
  PREVIEW_VIEW_BUTTON_GROUP,
  PREVIEW_VIEW_BUTTON_IDS
} from './preview.js';
import { closeAddContentMenu } from './content.js';

const slideListDragState = {
  fromV: null,
  active: false,
  group: null
};

// Multi-selection of slides in the selected column (sidebar). Always in the column `h`.
const slideMultiSelect = { h: null, vs: new Set(), anchor: null };

function clearSlideMultiSelect() {
  slideMultiSelect.h = null;
  slideMultiSelect.vs.clear();
  slideMultiSelect.anchor = null;
}

function getSlideMultiSelection(hIndex) {
  if (slideMultiSelect.h !== hIndex || slideMultiSelect.vs.size < 2) return [];
  return [...slideMultiSelect.vs].sort((a, b) => a - b);
}

// Moves several slides of the selected column next to toV, keeping their order.
// Returns the new indices of the moved slides, or null.
function reorderSlideGroupWithinSelectedColumn(vs, toV, place = 'before') {
  const column = state.stacks[state.selected.h];
  if (!Array.isArray(column) || !Array.isArray(vs) || !vs.length) return null;
  const picked = [...new Set(vs)].filter((v) => column[v]).sort((a, b) => a - b).map((v) => column[v]);
  if (!picked.length) return null;
  const pickedSet = new Set(picked);
  const limit = place === 'after' ? toV + 1 : toV;
  const insertIndex = column.slice(0, Math.max(limit, 0)).filter((slide) => !pickedSet.has(slide)).length;
  const rest = column.filter((slide) => !pickedSet.has(slide));
  rest.splice(insertIndex, 0, ...picked);
  column.splice(0, column.length, ...rest);
  return picked.map((slide) => column.indexOf(slide));
}

function clearSlideDragIndicators() {
  if (!slideListEl) return;
  slideListEl.querySelectorAll('.slide-item.drag-over-before, .slide-item.drag-over-after').forEach((el) => {
    el.classList.remove('drag-over-before', 'drag-over-after');
  });
}

function keepActiveSlideVisible() {
  if (!slideListEl) return;
  const activeItem = slideListEl.querySelector('.slide-item.active');
  if (!(activeItem instanceof HTMLElement)) return;
  activeItem.scrollIntoView({
    block: 'nearest',
    inline: 'nearest'
  });
}

function clampIndex(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function reorderSlideWithinSelectedColumn(fromV, toV, place = 'before') {
  const h = state.selected.h;
  const column = state.stacks[h];
  if (!Array.isArray(column)) return null;
  if (!Number.isInteger(fromV) || !Number.isInteger(toV)) return null;
  if (fromV < 0 || fromV >= column.length || toV < 0 || toV >= column.length) return null;
  const insertOffset = place === 'after' ? 1 : 0;
  let insertIndex = toV + insertOffset;
  if (fromV < insertIndex) insertIndex -= 1;
  insertIndex = clampIndex(insertIndex, 0, Math.max(column.length - 1, 0));
  if (fromV === insertIndex) return fromV;
  const [moved] = column.splice(fromV, 1);
  if (!moved) return null;
  column.splice(insertIndex, 0, moved);
  return insertIndex;
}

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
  refreshSlideProperties();
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

// Strips markdown syntax for display in the slide navigator tile. NOT an HTML sanitizer —
// output must only be assigned to .textContent, never .innerHTML or equivalent.
function plainSlideText(text) {
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/^#+\s*/gm, '')
    .trim();
}

function buildDefaultSlideNavigatorTile(slide, vIndex) {
  const shell = document.createElement('div');
  shell.className = 'slide-tile';

  if (hasTopMatterContent(slide?.top || '')) {
    const topBar = document.createElement('div');
    topBar.className = 'slide-tile-topmatter';
    shell.appendChild(topBar);
  }

  const id = document.createElement('div');
  id.className = 'slide-tile-id';
  id.textContent = `V${vIndex + 1}`;
  shell.appendChild(id);

  const title = document.createElement('div');
  title.className = 'slide-tile-title';
  title.textContent = titleFromSlide(slide?.body || '');
  shell.appendChild(title);

  const body = document.createElement('div');
  body.className = 'slide-tile-body';
  const lines = plainSlideText(slide?.body || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (!lines.length) {
    body.textContent = tr('(blank slide)');
    body.classList.add('is-empty');
  } else {
    lines.forEach((line) => {
      const lineEl = document.createElement('div');
      lineEl.textContent = line;
      body.appendChild(lineEl);
    });
  }
  shell.appendChild(body);
  return shell;
}

function buildPluginSlideNavigatorTile(slide, hIndex, vIndex, isActive, selectedVs = []) {
  const host = window.RevelationBuilderHost;
  const renderer = host && typeof host.getSlideNavigatorRenderer === 'function'
    ? host.getSlideNavigatorRenderer()
    : null;
  if (typeof renderer !== 'function') return null;
  try {
    const rendered = renderer({
      host,
      slide,
      h: hIndex,
      v: vIndex,
      isActive,
      selectedVs,
      clearMultiSelection() {
        clearSlideMultiSelect();
        renderSlideList();
      },
      setMultiSelection(vs) {
        clearSlideMultiSelect();
        if (Array.isArray(vs) && vs.length > 1) {
          slideMultiSelect.h = state.selected.h;
          slideMultiSelect.vs = new Set(vs);
          slideMultiSelect.anchor = vs[0];
        }
        renderSlideList();
      },
      hasTopMatter: hasTopMatterContent(slide?.top || '')
    });
    return rendered instanceof HTMLElement ? rendered : null;
  } catch (err) {
    console.warn('Slide navigator renderer failed:', err);
    return null;
  }
}

// Moves a dragged group and keeps it selected; returns the index to focus.
function finishGroupDrop(group, toV, place) {
  const moved = reorderSlideGroupWithinSelectedColumn(group, toV, place);
  if (!moved || !moved.length) return null;
  slideMultiSelect.h = state.selected.h;
  slideMultiSelect.vs = new Set(moved);
  slideMultiSelect.anchor = moved[0];
  return moved[0];
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
  if (slideMultiSelect.h !== null) {
    if (slideMultiSelect.h !== hIndex) clearSlideMultiSelect();
    else {
      slideMultiSelect.vs.forEach((v) => { if (!column[v]) slideMultiSelect.vs.delete(v); });
      if (slideMultiSelect.vs.size < 2) clearSlideMultiSelect();
    }
  }
  const multiVs = getSlideMultiSelection(hIndex);
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
    item.className = 'slide-item slide-item-tile';
    item.dataset.vIndex = String(vIndex);
    item.draggable = !state.columnMarkdownMode;
    if (state.selected.v === vIndex) {
      item.classList.add('active');
    }
    const inMulti = multiVs.includes(vIndex);
    if (inMulti) item.classList.add('multi-selected');
    const pluginTile = buildPluginSlideNavigatorTile(slide, hIndex, vIndex, state.selected.v === vIndex, multiVs);
    item.appendChild(pluginTile || buildDefaultSlideNavigatorTile(slide, vIndex));
    item.addEventListener('click', (event) => {
      if (event.shiftKey) {
        // Range from the anchor (or current slide) to the clicked slide.
        const anchor = Number.isInteger(slideMultiSelect.anchor) && slideMultiSelect.h === hIndex
          ? slideMultiSelect.anchor
          : state.selected.v;
        slideMultiSelect.h = hIndex;
        slideMultiSelect.anchor = anchor;
        slideMultiSelect.vs = new Set();
        for (let i = Math.min(anchor, vIndex); i <= Math.max(anchor, vIndex); i += 1) slideMultiSelect.vs.add(i);
        renderSlideList();
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (slideMultiSelect.h !== hIndex) {
          clearSlideMultiSelect();
          slideMultiSelect.h = hIndex;
        }
        if (!slideMultiSelect.vs.size) slideMultiSelect.vs.add(state.selected.v);
        if (slideMultiSelect.vs.has(vIndex)) slideMultiSelect.vs.delete(vIndex);
        else slideMultiSelect.vs.add(vIndex);
        slideMultiSelect.anchor = vIndex;
        selectSlide(hIndex, vIndex);
        return;
      }
      clearSlideMultiSelect();
      selectSlide(hIndex, vIndex);
    });
    item.addEventListener('dragstart', (event) => {
      if (state.columnMarkdownMode) return;
      slideListDragState.group = inMulti ? multiVs : null;
      slideListDragState.fromV = vIndex;
      slideListDragState.active = true;
      item.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(vIndex));
      }
    });
    item.addEventListener('dragend', () => {
      slideListDragState.group = null;
      slideListDragState.fromV = null;
      slideListDragState.active = false;
      item.classList.remove('is-dragging');
      clearSlideDragIndicators();
    });
    item.addEventListener('dragover', (event) => {
      if (!slideListDragState.active || slideListDragState.fromV === null) return;
      event.preventDefault();
      clearSlideDragIndicators();
      const rect = item.getBoundingClientRect();
      const place = event.clientY >= rect.top + rect.height / 2 ? 'after' : 'before';
      item.classList.add(place === 'after' ? 'drag-over-after' : 'drag-over-before');
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over-before', 'drag-over-after');
    });
    item.addEventListener('drop', (event) => {
      if (!slideListDragState.active || slideListDragState.fromV === null) return;
      event.preventDefault();
      const rect = item.getBoundingClientRect();
      const place = event.clientY >= rect.top + rect.height / 2 ? 'after' : 'before';
      const group = slideListDragState.group;
      const nextV = group
        ? finishGroupDrop(group, vIndex, place)
        : reorderSlideWithinSelectedColumn(slideListDragState.fromV, vIndex, place);
      slideListDragState.group = null;
      slideListDragState.fromV = null;
      slideListDragState.active = false;
      clearSlideDragIndicators();
      if (!Number.isInteger(nextV)) return;
      selectSlide(hIndex, nextV);
      markDirty();
      schedulePreviewUpdate();
    });

    slideListEl.appendChild(item);
  });

  if (!state.columnMarkdownMode && column.length > 0) {
    const appendZone = document.createElement('div');
    appendZone.className = 'slide-drop-zone';
    appendZone.textContent = tr('Drop here to move to end');
    appendZone.addEventListener('dragover', (event) => {
      if (!slideListDragState.active || slideListDragState.fromV === null) return;
      event.preventDefault();
      appendZone.classList.add('is-active');
    });
    appendZone.addEventListener('dragleave', () => {
      appendZone.classList.remove('is-active');
    });
    appendZone.addEventListener('drop', (event) => {
      if (!slideListDragState.active || slideListDragState.fromV === null) return;
      event.preventDefault();
      appendZone.classList.remove('is-active');
      const fromV = slideListDragState.fromV;
      const targetV = column.length - 1;
      const group = slideListDragState.group;
      const nextV = group
        ? finishGroupDrop(group, targetV, 'after')
        : reorderSlideWithinSelectedColumn(fromV, targetV, 'after');
      slideListDragState.group = null;
      slideListDragState.fromV = null;
      slideListDragState.active = false;
      clearSlideDragIndicators();
      if (!Number.isInteger(nextV)) return;
      selectSlide(hIndex, nextV);
      markDirty();
      schedulePreviewUpdate();
    });
    slideListEl.appendChild(appendZone);
  }

  updateColumnLabel();
  updateColumnSplitButton();
  updateColumnMarkdownButton();
  updateTopMatterIndicator();
  updateColumnMoveMenuItems();
  updateSlideMenuItems();
  keepActiveSlideVisible();
}

function selectSlide(hIndex, vIndex, options = {}) {
  const { syncPreview = true } = options;
  const maxH = Math.max(state.stacks.length - 1, 0);
  const safeH = Math.min(Math.max(hIndex, 0), maxH);
  const column = state.stacks[safeH] || [createEmptySlide()];
  const maxV = Math.max(column.length - 1, 0);
  const safeV = Math.min(Math.max(vIndex, 0), maxV);
  state.selected = { h: safeH, v: safeV };
  const slide = state.stacks[safeH][safeV] || createEmptySlide();
  topEditorEl.value = slide.top || '';
  editorEl.value = slide.body || '';
  notesEditorEl.value = slide.notes || '';
  updateNotesPeek();
  refreshNotesRich();
  renderSlideList();
  updateTopMatterIndicator();
  if (syncPreview) {
    syncPreviewToEditor();
  }
  if (typeof window.__revelationBuilderHostInternalEmit === 'function') {
    window.__revelationBuilderHostInternalEmit('selection:changed', {
      h: state.selected.h,
      v: state.selected.v,
      source: 'builder'
    });
  }
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
    setSaveButtonLabel(state.dirty ? tr('Save Now') : tr('Already Saved'));
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

// Slide index (within the column) of the slide holding the caret.
function getColumnMarkdownCaretSlide() {
  if (!columnMarkdownEditor) return 0;
  const before = columnMarkdownEditor.value.slice(0, columnMarkdownEditor.selectionStart);
  return splitByMarkerLines(before, '---').length - 1;
}

// Put the caret at the start of slide `vIndex`, matching getColumnMarkdown's joins.
function placeColumnMarkdownCaret(vIndex) {
  if (!columnMarkdownEditor) return;
  const column = state.stacks[state.columnMarkdownColumn] || [];
  const joinerV = '\n\n---\n\n';
  let offset = 0;
  for (let i = 0; i < Math.min(vIndex, column.length); i += 1) {
    offset += buildSlide(column[i]).length + joinerV.length;
  }
  columnMarkdownEditor.setSelectionRange(offset, offset);
}

// Move the preview to the slide under the caret. Only acts when the caret
// crosses into another slide, so navigating the preview by hand still works.
let lastCaretPreviewTarget = null;
function syncPreviewToColumnMarkdownCaret({ force = false } = {}) {
  if (!state.columnMarkdownMode || !state.previewReady) return;
  const deck = getPreviewDeck();
  if (!deck) return;
  const h = state.columnMarkdownColumn;
  const v = getColumnMarkdownCaretSlide();
  const key = `${h}:${v}`;
  if (!force && key === lastCaretPreviewTarget) return;
  lastCaretPreviewTarget = key;
  try {
    deck.slide(h, v);
  } catch (err) {
    console.warn('Failed to sync preview to column markdown caret:', err);
  }
}

// Recompile the preview from the column text after typing pauses.
const COLUMN_MARKDOWN_PREVIEW_DELAY_MS = 4000;
let columnMarkdownPreviewTimer = null;
function cancelColumnMarkdownPreviewRefresh() {
  if (columnMarkdownPreviewTimer) {
    clearTimeout(columnMarkdownPreviewTimer);
    columnMarkdownPreviewTimer = null;
  }
}

function scheduleColumnMarkdownPreviewRefresh() {
  if (!state.columnMarkdownMode) return;
  cancelColumnMarkdownPreviewRefresh();
  columnMarkdownPreviewTimer = setTimeout(() => {
    columnMarkdownPreviewTimer = null;
    if (!state.columnMarkdownMode) return;
    applyCurrentColumnMarkdown();
    updatePreview({ force: true, silent: true }).catch((err) => {
      console.error(err);
      setStatus(trFormat('Preview update failed: {message}', { message: err.message }));
    });
  }, COLUMN_MARKDOWN_PREVIEW_DELAY_MS);
}

function enterColumnMarkdownMode() {
  if (state.columnMarkdownMode || !columnMarkdownEditor) return;
  state.columnMarkdownMode = true;
  state.columnMarkdownColumn = state.selected.h;
  columnMarkdownEditor.value = getColumnMarkdown(state.columnMarkdownColumn);
  placeColumnMarkdownCaret(state.selected.v);
  lastCaretPreviewTarget = `${state.columnMarkdownColumn}:${state.selected.v}`;
  cancelPreviewUpdateTimer();
  // The column editor takes the left half; show the plain slide preview beside it.
  setBuilderView('visual');
  window.RevelationBuilderHost?.setPreviewButtonGroupActive?.(
    PREVIEW_VIEW_BUTTON_GROUP,
    PREVIEW_VIEW_BUTTON_IDS.slide
  );
  applyColumnMarkdownMode();
  columnMarkdownEditor.focus();
  setStatus(tr('Column markdown mode enabled. The preview refreshes when you pause typing.'));
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
  columnMarkdownEditor.setSelectionRange(0, 0);
  lastCaretPreviewTarget = `${nextH}:0`;
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
  columnMarkdownEditor.setSelectionRange(0, 0);
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
    columnMarkdownEditor.setSelectionRange(0, 0);
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
  columnMarkdownEditor.setSelectionRange(0, 0);
  selectSlide(nextH, 0);
  renderSlideList();
  markDirty();
  columnMarkdownEditor.focus();
}

function exitColumnMarkdownMode() {
  if (!state.columnMarkdownMode || !columnMarkdownEditor) return;
  const targetH = state.columnMarkdownColumn;
  cancelColumnMarkdownPreviewRefresh();
  applyCurrentColumnMarkdown();
  state.columnMarkdownMode = false;
  lastCaretPreviewTarget = null;
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
  const nextH = h + 1;
  state.stacks.splice(h + 1, 0, [createEmptySlide()]);
  state.previewExpectedSelection = { h: nextH, v: 0, expiresAt: Date.now() + 6000 };
  state.previewSelectionLockUntil = Date.now() + 6000;
  selectSlide(nextH, 0, { syncPreview: false });
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
  const nextV = v + 1;
  state.stacks[h].splice(v + 1, 0, createEmptySlide());
  state.previewExpectedSelection = { h, v: nextV, expiresAt: Date.now() + 6000 };
  state.previewSelectionLockUntil = Date.now() + 6000;
  selectSlide(h, nextV, { syncPreview: false });
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
  const nextV = v + 1;
  const current = state.stacks[h][v] || createEmptySlide();
  const clone = {
    top: current.top || '',
    body: current.body || '',
    notes: current.notes || ''
  };
  state.stacks[h].splice(v + 1, 0, clone);
  state.previewExpectedSelection = { h, v: nextV, expiresAt: Date.now() + 6000 };
  state.previewSelectionLockUntil = Date.now() + 6000;
  selectSlide(h, nextV, { syncPreview: false });
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
function syncPreviewToEditor({ force = false } = {}) {
  if (state.columnMarkdownMode) {
    syncPreviewToColumnMarkdownCaret({ force });
    return;
  }
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
  const currentSlide = column[targetV] || createEmptySlide();
  const hasBodyOrNotes = Boolean(currentSlide.body?.trim() || currentSlide.notes?.trim());
  const reuseCurrentSlide = !hasBodyOrNotes;
  const before = reuseCurrentSlide ? column.slice(0, targetV) : column.slice(0, targetV + 1);
  const after = column.slice(targetV + 1);
  const [firstColumn, ...restColumns] = cleaned;
  if (reuseCurrentSlide && currentSlide.top?.trim() && firstColumn.length) {
    const firstInsertedSlide = firstColumn[0];
    const insertedTop = firstInsertedSlide.top?.trim() || '';
    const currentTop = currentSlide.top.trim();
    firstInsertedSlide.top = insertedTop ? `${currentTop}\n${insertedTop}` : currentTop;
  }
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
  syncPreviewToColumnMarkdownCaret,
  scheduleColumnMarkdownPreviewRefresh,
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
