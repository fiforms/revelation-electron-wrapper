/*
 * Builder view layout switcher.
 *
 * Sections:
 * - View state + persistence
 * - Applying a view
 * - Setup
 *
 * Views:
 * - visual:   slide list + preview/rich editor (2 columns)
 * - markdown: slide list + top matter / slide markdown / notes (2 columns)
 * - split:    classic 3-column layout (markdown and preview side by side)
 *
 * The markdown textarea stays in the DOM in every view; the rich editor syncs
 * through it, so switching views never changes how edits are stored. In the
 * visual view the Notes panel moves under the preview as a compact bar; the
 * same element is moved, so its value and listeners carry over.
 */
import { editorEl, notesEditorEl } from './context.js';
import { getPreviewDeck } from './slides.js';

// --- View state + persistence ---
const VIEWS = ['visual', 'markdown', 'split'];
const DEFAULT_VIEW = 'visual';
const STORAGE_KEY = 'revelation.builder.view';

let currentView = DEFAULT_VIEW;

function readSavedView() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return VIEWS.includes(saved) ? saved : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

function saveView(view) {
  try {
    localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // Storage unavailable; the view just won't persist.
  }
}

// --- Applying a view ---
// Reveal measures its container, so relayout after the preview becomes visible again.
function relayoutPreview() {
  requestAnimationFrame(() => {
    const deck = getPreviewDeck();
    if (deck && typeof deck.layout === 'function') {
      deck.layout();
      window.setTimeout(() => deck.layout?.(), 140);
    }
  });
}

function placeNotesPanel(view) {
  const notesPanel = document.querySelector('.builder-notes');
  const target = document.querySelector(view === 'visual' ? '.builder-right' : '.builder-middle');
  if (notesPanel && target && notesPanel.parentElement !== target) {
    target.appendChild(notesPanel);
  }
  // The dragged height only applies to the bottom bar; the middle column sizes notes itself.
  if (view === 'visual') {
    applySavedNotesHeight();
  } else if (notesEditorEl) {
    notesEditorEl.style.height = '';
  }
}

// First non-blank notes line, shown in the collapsed Notes header.
function updateNotesPeek() {
  const peekEl = document.getElementById('notes-peek');
  if (!peekEl) return;
  const firstLine = String(notesEditorEl?.value || '').split(/\r?\n/).find((line) => line.trim()) || '';
  peekEl.textContent = firstLine.trim();
}

function setBuilderView(view, { persist = true, focus = false } = {}) {
  const next = VIEWS.includes(view) ? view : DEFAULT_VIEW;
  const previous = currentView;
  currentView = next;
  document.body.dataset.builderView = next;
  placeNotesPanel(next);
  document.querySelectorAll('[data-builder-view-option]').forEach((button) => {
    const active = button.dataset.builderViewOption === next;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (persist) saveView(next);
  if (previous !== next && next !== 'markdown') relayoutPreview();
  if (focus && next === 'markdown' && editorEl) editorEl.focus();
}

function getBuilderView() {
  return currentView;
}

// Ctrl+E: flip between Visual and Markdown (Split goes to Markdown).
function toggleMarkdownView() {
  setBuilderView(currentView === 'markdown' ? 'visual' : 'markdown', { focus: true });
}

// --- Notes bar resizing ---
// Dragging the divider sets the notes textarea height. Dragging up from a
// collapsed bar expands it; dragging down to almost nothing collapses it.
const NOTES_HEIGHT_KEY = 'revelation.builder.notesHeight';
const NOTES_MIN_HEIGHT = 36;
const NOTES_COLLAPSE_BELOW = 24;
const PREVIEW_MIN_HEIGHT = 160;

function setNotesCollapsed(panel, collapsed) {
  panel.classList.toggle('is-collapsed', collapsed);
  panel.querySelector('.panel-toggle')?.setAttribute('aria-expanded', String(!collapsed));
}

function getMaxNotesHeight(panel) {
  const right = document.querySelector('.builder-right');
  const header = panel.querySelector('.panel-header');
  if (!right) return 400;
  return Math.max(NOTES_MIN_HEIGHT, right.clientHeight - PREVIEW_MIN_HEIGHT - (header?.offsetHeight || 0));
}

function applySavedNotesHeight() {
  try {
    const saved = Number(localStorage.getItem(NOTES_HEIGHT_KEY));
    if (saved >= NOTES_MIN_HEIGHT && notesEditorEl) notesEditorEl.style.height = `${saved}px`;
  } catch {
    // Storage unavailable; keep the default height.
  }
}

function setupNotesResizer() {
  const panel = document.querySelector('.builder-notes');
  const handle = panel?.querySelector('.notes-resizer');
  if (!panel || !handle || !notesEditorEl) return;

  let startY = 0;
  let startHeight = 0;
  let dragging = false;

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    startY = event.clientY;
    startHeight = panel.classList.contains('is-collapsed') ? 0 : notesEditorEl.offsetHeight;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('is-dragging');
    document.body.classList.add('is-resizing-notes');
  });

  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const next = startHeight + (startY - event.clientY);
    if (next < NOTES_COLLAPSE_BELOW) {
      setNotesCollapsed(panel, true);
      return;
    }
    setNotesCollapsed(panel, false);
    const height = Math.min(Math.max(next, NOTES_MIN_HEIGHT), getMaxNotesHeight(panel));
    notesEditorEl.style.height = `${height}px`;
  });

  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    handle.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing-notes');
    if (!panel.classList.contains('is-collapsed')) {
      try {
        localStorage.setItem(NOTES_HEIGHT_KEY, String(notesEditorEl.offsetHeight));
      } catch {
        // Storage unavailable; the height just won't persist.
      }
    }
    relayoutPreview();
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}

// --- Setup ---
function setupLayoutSwitcher() {
  document.querySelectorAll('[data-builder-view-option]').forEach((button) => {
    button.addEventListener('click', () => {
      setBuilderView(button.dataset.builderViewOption, { focus: true });
    });
  });
  notesEditorEl?.addEventListener('input', updateNotesPeek);
  setupNotesResizer();
  setBuilderView(readSavedView(), { persist: false });
  updateNotesPeek();
}

export { setupLayoutSwitcher, setBuilderView, getBuilderView, toggleMarkdownView, updateNotesPeek };
