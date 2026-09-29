/*
 * Unified undo/redo history for the whole builder.
 *
 * Sections:
 * - Snapshots
 * - Recording
 * - Undo / redo
 * - Input routing
 * - Setup
 *
 * History is a list of document snapshots (front matter + slide stacks, with
 * the selection and caret to put back). Every document change reaches
 * markDirty(), so a dirty listener records them all:
 * - typing (changes made inside an input event) is grouped and committed
 *   after a pause,
 * - paste, cut, drop, Enter and deleting a selection get their own step,
 * - anything else (menus, slide operations, plugin transactions) commits as
 *   soon as the operation finishes.
 * Pending typing is committed before a click or a Ctrl/Cmd shortcut, so it
 * never merges into the operation that follows.
 *
 * Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z and the native Undo/Redo commands use this
 * history in the document editors and anywhere that is not a text field.
 * Other text fields (dialog inputs) keep native undo. A plugin editor opts in
 * with data-builder-history="document", and should sync pending edits into
 * the document on the host's 'history:flush' event.
 */
import { state, columnMarkdownEditor } from './context.js';
import { markDirty, addDirtyListener, setStatus, setSaveIndicator, setSaveState, updatePresentationPropertiesState } from './app-state.js';
import { getNoteSeparatorFromFrontmatter } from './markdown.js';
import { selectSlide, getColumnMarkdown, parseColumnMarkdown, scheduleColumnMarkdownPreviewRefresh } from './slides.js';
import { schedulePreviewUpdate } from './preview.js';

const MAX_ENTRIES = 200;
const TYPING_COMMIT_DELAY_MS = 1000;
// Long unbroken typing still gets split into steps this long.
const TYPING_GROUP_MAX_MS = 5000;
// Input types that end the current typing group and form their own step.
const BOUNDARY_INPUT_TYPES = new Set([
  'insertParagraph',
  'insertLineBreak',
  'insertFromPaste',
  'insertFromPasteAsQuotation',
  'insertFromDrop',
  'insertReplacementText',
  'deleteByCut',
  'deleteByDrag'
]);
const DOCUMENT_FIELD_SELECTOR = [
  '#slide-editor',
  '#top-editor',
  '#notes-editor',
  '#column-markdown-editor',
  '#notes-rich',
  '.richbuilder-editor',
  '[data-builder-history="document"]'
].join(', ');

let entries = [];
let index = -1;
let savedKey = null;
let typingTimer = 0;
let typingGroupStartedAt = 0;
let immediateTimer = 0;
let restoring = false;
let inInputEvent = false;
let boundaryPendingUntil = 0;
let lastKeyHandledAt = 0;

// --- Snapshots ---
// Column markdown edits reach state.stacks only when applied, so read the text.
function captureStacks() {
  if (!state.columnMarkdownMode || !columnMarkdownEditor) return state.stacks;
  const stacks = state.stacks.slice();
  stacks[state.columnMarkdownColumn] = parseColumnMarkdown(columnMarkdownEditor.value);
  return stacks;
}

// Rich (contenteditable) editors are re-rendered on restore, so their caret
// is kept as the index of the top-level block holding it plus a text offset
// within that block. Text inside contenteditable=false tokens isn't counted.
function editableTextNodes(block) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('[contenteditable="false"]')
      ? NodeFilter.FILTER_REJECT
      : NodeFilter.FILTER_ACCEPT)
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function captureRichPoint(root, node, offset) {
  let block = node;
  while (block && block.parentNode !== root) block = block.parentNode;
  if (!block) return { block: 0, offset: 0 };
  const range = document.createRange();
  range.setStart(block, 0);
  range.setEnd(node, offset);
  let textOffset = 0;
  editableTextNodes(block).forEach((text) => {
    if (!range.intersectsNode(text)) return;
    textOffset += text === range.endContainer ? range.endOffset : text.length;
  });
  return { block: Array.prototype.indexOf.call(root.childNodes, block), offset: textOffset };
}

function resolveRichPoint(root, point) {
  const blocks = root.childNodes;
  if (!blocks.length) return { node: root, offset: 0 };
  const block = blocks[Math.min(Math.max(point.block, 0), blocks.length - 1)];
  const texts = editableTextNodes(block);
  let remaining = point.offset;
  for (const text of texts) {
    if (remaining <= text.length) return { node: text, offset: remaining };
    remaining -= text.length;
  }
  const last = texts[texts.length - 1];
  return last ? { node: last, offset: last.length } : { node: block, offset: 0 };
}

function captureCaret() {
  const el = document.activeElement;
  if (!isDocumentField(el)) return null;
  if (el instanceof HTMLTextAreaElement) {
    return el.id ? { el, start: el.selectionStart, end: el.selectionEnd } : null;
  }
  const selection = window.getSelection();
  if (!el.isContentEditable || !selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  return {
    el,
    rich: true,
    start: captureRichPoint(el, range.startContainer, range.startOffset),
    end: captureRichPoint(el, range.endContainer, range.endOffset)
  };
}

function takeSnapshot() {
  const frontmatter = String(state.frontmatter || '');
  const stacksJson = JSON.stringify(captureStacks());
  return {
    key: `${frontmatter}\u0000${stacksJson}`,
    frontmatter,
    stacksJson,
    selected: { h: state.selected.h, v: state.selected.v },
    caret: captureCaret()
  };
}

// --- Recording ---
function clearTimers() {
  if (typingTimer) clearTimeout(typingTimer);
  if (immediateTimer) clearTimeout(immediateTimer);
  typingTimer = 0;
  immediateTimer = 0;
}

function hasPending() {
  return !!(typingTimer || immediateTimer);
}

function commit() {
  clearTimers();
  if (restoring || index < 0) return;
  const snapshot = takeSnapshot();
  if (snapshot.key === entries[index].key) {
    updateButtons();
    return;
  }
  entries.splice(index + 1);
  entries.push(snapshot);
  if (entries.length > MAX_ENTRIES) entries.shift();
  index = entries.length - 1;
  updateButtons();
}

function commitPending() {
  if (hasPending()) commit();
}

// Dirty listener: decide how this change is grouped.
function noteChange() {
  if (restoring || index < 0) return;
  const boundary = boundaryPendingUntil > Date.now();
  if (inInputEvent && !boundary) {
    const now = Date.now();
    if (!typingTimer) typingGroupStartedAt = now;
    if (typingTimer) clearTimeout(typingTimer);
    const delay = now - typingGroupStartedAt >= TYPING_GROUP_MAX_MS ? 0 : TYPING_COMMIT_DELAY_MS;
    typingTimer = setTimeout(commit, delay);
  } else if (!immediateTimer) {
    boundaryPendingUntil = 0;
    // Let the operation finish before taking the snapshot.
    immediateTimer = setTimeout(commit, 0);
  }
  updateButtons();
}

// Ask editors that sync on a delay (e.g. the rich editor) to sync now.
function flushEditors() {
  if (typeof window.__revelationBuilderHostInternalEmit === 'function') {
    window.__revelationBuilderHostInternalEmit('history:flush', {});
  }
}

// Start a fresh history at the current document (after loading).
function resetHistory() {
  clearTimers();
  entries = [takeSnapshot()];
  index = 0;
  savedKey = entries[0].key;
  updateButtons();
}

// Remember the saved state so undoing back to it clears the dirty flag.
function markHistorySaved() {
  if (index < 0) return;
  commit();
  savedKey = entries[index].key;
}

// Record a change made outside markDirty (e.g. re-parse).
function recordHistoryChange() {
  noteChange();
}

// --- Undo / redo ---
function restoreCaret(caret) {
  const el = caret?.el;
  if (!el || !el.isConnected || !el.offsetParent) return;
  if (!caret.rich) {
    const length = el.value.length;
    el.focus();
    el.setSelectionRange(Math.min(caret.start, length), Math.min(caret.end, length));
    return;
  }
  const start = resolveRichPoint(el, caret.start);
  const end = resolveRichPoint(el, caret.end);
  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    range.setStart(start.node, start.offset);
    range.collapse(true);
  }
  el.focus({ preventScroll: true });
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const caretElement = start.node.nodeType === Node.ELEMENT_NODE ? start.node : start.node.parentElement;
  caretElement?.scrollIntoView?.({ block: 'nearest' });
}

function restore(snapshot) {
  restoring = true;
  try {
    state.frontmatter = snapshot.frontmatter;
    state.noteSeparator = getNoteSeparatorFromFrontmatter(snapshot.frontmatter);
    state.stacks = JSON.parse(snapshot.stacksJson);
    if (state.columnMarkdownMode && columnMarkdownEditor) {
      const h = Math.min(Math.max(snapshot.selected.h, 0), state.stacks.length - 1);
      state.columnMarkdownColumn = h;
      columnMarkdownEditor.value = getColumnMarkdown(h);
      selectSlide(h, 0);
    } else {
      selectSlide(snapshot.selected.h, snapshot.selected.v);
    }
    restoreCaret(snapshot.caret);
    if (snapshot.key === savedKey) {
      state.dirty = false;
      setSaveIndicator(tr('Saved'));
      setSaveState(false);
      updatePresentationPropertiesState();
      window.__revelationBuilderHostInternalEmit?.('document:changed', { dirty: false, source: 'history' });
    } else {
      markDirty();
    }
  } finally {
    restoring = false;
  }
  // Drop anything the restore itself queued.
  clearTimers();
  if (state.columnMarkdownMode) {
    scheduleColumnMarkdownPreviewRefresh();
  } else {
    schedulePreviewUpdate();
  }
  updateButtons();
}

function undo() {
  if (index < 0) return;
  flushEditors();
  commit();
  if (index <= 0) {
    setStatus(tr('Nothing to undo.'));
    return;
  }
  index -= 1;
  restore(entries[index]);
}

function redo() {
  if (index < 0) return;
  flushEditors();
  commit();
  if (index >= entries.length - 1) {
    setStatus(tr('Nothing to redo.'));
    return;
  }
  index += 1;
  restore(entries[index]);
}

function updateButtons() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  if (undoBtn) undoBtn.disabled = !(index > 0 || hasPending());
  if (redoBtn) redoBtn.disabled = !(index >= 0 && index < entries.length - 1 && !hasPending());
}

// --- Input routing ---
function isDocumentField(target) {
  return target instanceof Element && !!target.closest(DOCUMENT_FIELD_SELECTOR);
}

function isTextField(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image'].includes(target.type);
  }
  return target.isContentEditable;
}

// True when Ctrl+Z at this target should use the builder history.
function ownsTarget(target) {
  return isDocumentField(target) || !isTextField(target);
}

function hasSelectedText(target) {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    return target.selectionStart !== target.selectionEnd;
  }
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed;
}

// Undo/redo from the builder's context menu (main process).
function runMenuCommand(action) {
  const command = action === 'redo' ? 'redo' : 'undo';
  if (ownsTarget(document.activeElement)) {
    if (command === 'redo') redo();
    else undo();
  } else {
    document.execCommand(command);
  }
  return true;
}

// --- Setup ---
function setupHistory() {
  addDirtyListener(noteChange);

  // Changes made while an input event is dispatched count as typing. The
  // window bubble listener runs after the field's own handlers.
  document.addEventListener('input', () => {
    inInputEvent = true;
    setTimeout(() => { inInputEvent = false; }, 0);
  }, true);
  window.addEventListener('input', () => {
    inInputEvent = false;
  });

  document.addEventListener('beforeinput', (event) => {
    const type = String(event.inputType || '');
    if (type === 'historyUndo' || type === 'historyRedo') {
      // Native Undo/Redo (edit menu). Skip it if a key press already ran ours.
      if (!ownsTarget(event.target)) return;
      event.preventDefault();
      if (Date.now() - lastKeyHandledAt < 150) return;
      if (type === 'historyRedo') redo();
      else undo();
      return;
    }
    if (!isDocumentField(event.target)) return;
    if (BOUNDARY_INPUT_TYPES.has(type) || (type.startsWith('delete') && hasSelectedText(event.target))) {
      flushEditors();
      commitPending();
      boundaryPendingUntil = Date.now() + 1000;
    }
  }, true);

  // Editors with their own paste/cut/drop handling may cancel the native
  // input, so start a new step from these events too.
  ['paste', 'cut', 'drop'].forEach((type) => {
    document.addEventListener(type, (event) => {
      if (!isDocumentField(event.target)) return;
      flushEditors();
      commitPending();
      boundaryPendingUntil = Date.now() + 1000;
    }, true);
  });

  document.addEventListener('keydown', (event) => {
    const hasCommand = event.ctrlKey || event.metaKey;
    if (!hasCommand || event.altKey) return;
    const key = String(event.key || '').toLowerCase();
    const isUndo = key === 'z' && !event.shiftKey;
    const isRedo = key === 'y' || (key === 'z' && event.shiftKey);
    if ((isUndo || isRedo) && ownsTarget(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      lastKeyHandledAt = Date.now();
      if (isRedo) redo();
      else undo();
      return;
    }
    // A shortcut operation is about to run; keep earlier typing separate.
    flushEditors();
    commitPending();
  }, true);

  document.addEventListener('pointerdown', () => {
    flushEditors();
    commitPending();
  }, true);

  document.getElementById('undo-btn')?.addEventListener('click', undo);
  document.getElementById('redo-btn')?.addEventListener('click', redo);
  window.__revelationBuilderHistory = { undo, redo, menu: runMenuCommand };
  updateButtons();
}

export {
  setupHistory,
  resetHistory,
  markHistorySaved,
  recordHistoryChange,
  undo,
  redo
};
