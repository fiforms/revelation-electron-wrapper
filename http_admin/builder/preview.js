/*
 * Preview update, polling, and bridge synchronization.
 *
 * Sections:
 * - Preview updates
 * - Reveal.js bridge/polling
 * - Preview mode toggles
 */
import {
  tr,
  trFormat,
  previewFrame,
  previewSlideBtn,
  previewOverviewBtn,
  slug,
  mdFile,
  dir,
  tempFile,
  state
} from './context.js';
import { setStatus } from './app-state.js';
import { getFullMarkdown } from './document.js';
import { selectSlide, syncPreviewToEditor } from './slides.js';

// --- Preview updates ---
let previewTimer = null;

function cancelPreviewUpdateTimer() {
  if (previewTimer) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
}

function schedulePreviewUpdate(delayMs = 400) {
  if (state.columnMarkdownMode) return;
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    updatePreview().catch((err) => {
      console.error(err);
      setStatus(trFormat('Preview update failed: {message}', { message: err.message }));
    });
  }, delayMs);
}

async function updatePreview({ force = false, silent = false } = {}) {
  if (state.columnMarkdownMode && !force) {
    if (!silent) {
      setStatus(tr('Preview updates are paused in column markdown mode.'));
    }
    return;
  }
  if (!window.electronAPI?.savePresentationMarkdown) return;
  const content = getFullMarkdown();
  await window.electronAPI.savePresentationMarkdown({
    slug,
    mdFile,
    content,
    targetFile: tempFile
  });
  const previewUrl = `/${dir}/${slug}/index.html?p=${tempFile}&forceControls=1`;
  previewFrame.src = previewUrl;
  if (!silent) {
    setStatus(tr('Preview updated.'));
  }
}

// --- Preview mode toggles ---
function setPreviewMode(isOverview) {
  previewSlideBtn.classList.toggle('is-active', !isOverview);
  previewOverviewBtn.classList.toggle('is-active', !!isOverview);
}

// --- Reveal.js bridge/polling ---
function getPreviewDeck() {
  const win = previewFrame?.contentWindow;
  return win?.deck || win?.Reveal || null;
}

function attachPreviewBridge() {
  const deck = getPreviewDeck();
  if (!deck || state.previewReady) return;
  state.previewReady = true;

  if (typeof deck.isOverview === 'function') {
    setPreviewMode(deck.isOverview());
  }

  deck.on('slidechanged', () => {
    if (state.previewSyncing || state.columnMarkdownMode) return;
    const indices = deck.getIndices ? deck.getIndices() : null;
    if (!indices) return;
    if (indices.h === state.selected.h && indices.v === state.selected.v) return;
    selectSlide(indices.h, indices.v);
  });

  deck.on('overviewshown', () => setPreviewMode(true));
  deck.on('overviewhidden', () => setPreviewMode(false));

  deck.on('ready', () => {
    setPreviewMode(deck.isOverview ? deck.isOverview() : false);
    syncPreviewToEditor();
  });
}

function startPreviewPolling() {
  if (state.previewPoller) clearInterval(state.previewPoller);
  state.previewReady = false;
  state.previewPoller = setInterval(() => {
    if (state.previewReady) return;
    const deck = getPreviewDeck();
    if (deck && typeof deck.on === 'function') {
      clearInterval(state.previewPoller);
      state.previewPoller = null;
      attachPreviewBridge();
    }
  }, 250);
}

export {
  schedulePreviewUpdate,
  cancelPreviewUpdateTimer,
  updatePreview,
  startPreviewPolling,
  setPreviewMode,
  getPreviewDeck,
  attachPreviewBridge
};
