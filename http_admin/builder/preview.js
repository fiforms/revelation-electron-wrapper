/*
 * Preview update, polling, and bridge synchronization.
 *
 * Sections:
 * - Preview updates
 * - Reveal.js bridge/polling
 * - Preview mode toggles
 */
import {
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
import { extractFrontMatter, parseFrontMatterText, stringifyFrontMatter } from './markdown.js';
import { selectSlide, setColumnMarkdownColumn, syncPreviewToEditor } from './slides.js';
import { handlePreviewSlideChanged } from './timings.js';

// --- Preview updates ---
let previewTimer = null;
const PREVIEW_BRIDGE = 'revelation-builder-preview-bridge';
let previewCcliCache = null;
let previewCcliLoaded = false;
let preserveEditorSelectionUntil = 0;

const previewBridgeDeck = {
  _indices: { h: 0, v: 0 },
  _overview: false,
  _listeners: new Map(),
  on(eventName, callback) {
    if (!eventName || typeof callback !== 'function') return;
    if (!this._listeners.has(eventName)) {
      this._listeners.set(eventName, new Set());
    }
    this._listeners.get(eventName).add(callback);
  },
  emit(eventName, payload = {}) {
    const callbacks = this._listeners.get(eventName);
    if (!callbacks) return;
    callbacks.forEach((cb) => {
      try {
        cb(payload);
      } catch (err) {
        console.warn('Preview bridge listener failed:', err);
      }
    });
  },
  getIndices() {
    return { ...this._indices };
  },
  isOverview() {
    return !!this._overview;
  },
  slide(h = 0, v = 0) {
    sendPreviewCommand('slide', { h, v });
  },
  toggleOverview() {
    sendPreviewCommand('toggleOverview');
  }
};
window.__builderPreviewDeck = previewBridgeDeck;

let previewMessageHandlerBound = false;

function inferPreviewLanguage(content) {
  const fileMatch = String(mdFile || '').match(/_([a-z]{2,8}(?:-[a-z0-9]{2,8})?)\.md$/i);
  if (fileMatch) return fileMatch[1].toLowerCase();
  const { frontmatter } = extractFrontMatter(content || '');
  const data = parseFrontMatterText(frontmatter);
  if (data && typeof data === 'object' && data.alternatives && typeof data.alternatives === 'object') {
    const value = data.alternatives[mdFile];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().toLowerCase();
    }
  }
  return '';
}

function buildPreviewTempContent(content, previewLang) {
  const { frontmatter, body } = extractFrontMatter(content || '');
  const data = parseFrontMatterText(frontmatter);
  if (!data || typeof data !== 'object') {
    return content;
  }
  if (previewLang) {
    data.alternatives = { [tempFile]: previewLang };
  }
  delete data.variants;
  return `${stringifyFrontMatter(data)}${body}`;
}

function getPreviewOrigin() {
  const current = new URL(window.location.href);
  const port = current.port ? `:${current.port}` : '';
  return `${current.protocol}//127.0.0.1${port}`;
}

async function getPreviewCcliNumber() {
  if (previewCcliLoaded) return previewCcliCache;
  previewCcliLoaded = true;
  if (!window.electronAPI?.getAppConfig) {
    previewCcliCache = '';
    return previewCcliCache;
  }
  try {
    const config = await window.electronAPI.getAppConfig();
    previewCcliCache = String(config?.ccliLicenseNumber || '').trim();
  } catch {
    previewCcliCache = '';
  }
  return previewCcliCache;
}

function sendPreviewCommand(command, payload = {}) {
  const target = previewFrame?.contentWindow;
  if (!target) return;
  target.postMessage(
    {
      bridge: PREVIEW_BRIDGE,
      type: 'builder-command',
      command,
      payload
    },
    getPreviewOrigin()
  );
}

function bindPreviewBridgeListener() {
  if (previewMessageHandlerBound) return;
  previewMessageHandlerBound = true;
  window.addEventListener('message', (event) => {
    if (event.source !== previewFrame?.contentWindow) return;
    const data = event.data || {};
    if (data.bridge !== PREVIEW_BRIDGE || data.type !== 'preview-event') return;

    const eventName = String(data.event || '');
    const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
    const indices = payload.indices && typeof payload.indices === 'object'
      ? {
          h: Number.isFinite(Number(payload.indices.h)) ? Number(payload.indices.h) : 0,
          v: Number.isFinite(Number(payload.indices.v)) ? Number(payload.indices.v) : 0
        }
      : null;

    if (indices) {
      previewBridgeDeck._indices = indices;
    }
    if (typeof payload.isOverview === 'boolean') {
      previewBridgeDeck._overview = payload.isOverview;
    }

    if (eventName === 'ready') {
      state.previewReady = true;
      setPreviewMode(previewBridgeDeck.isOverview());
      previewBridgeDeck.emit('ready');
      syncPreviewToEditor();
      return;
    }

    if (eventName === 'slidechanged') {
      handlePreviewSlideChanged(previewBridgeDeck.getIndices());
      const current = previewBridgeDeck.getIndices();
      if (state.previewSyncing) return;
      if (state.previewExpectedSelection) {
        const expected = state.previewExpectedSelection;
        const expired = Date.now() > Number(expected.expiresAt || 0);
        if (expired) {
          state.previewExpectedSelection = null;
        } else {
          const matchesExpected = current.h === expected.h && current.v === expected.v;
          if (!matchesExpected) {
            syncPreviewToEditor();
            return;
          }
          state.previewExpectedSelection = null;
        }
      }
      if (state.columnMarkdownMode) {
        if (current.h === state.columnMarkdownColumn) return;
        setColumnMarkdownColumn(current.h, { focusEditor: false, syncPreview: false });
        return;
      }
      // During preview refresh, Reveal can briefly report slide 0/0.
      // Keep editor selection stable and snap preview back to the editor selection.
      if (Date.now() < preserveEditorSelectionUntil) {
        const { h, v } = state.selected;
        if (current.h === 0 && current.v === 0 && (h !== 0 || v !== 0)) {
          syncPreviewToEditor();
          return;
        }
      }
      if (current.h === state.selected.h && current.v === state.selected.v) return;
      selectSlide(current.h, current.v);
      return;
    }

    if (eventName === 'overview') {
      setPreviewMode(previewBridgeDeck.isOverview());
    }
  });
}

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
  const previewLang = inferPreviewLanguage(content);
  const previewContent = buildPreviewTempContent(content, previewLang);
  preserveEditorSelectionUntil = Date.now() + 1500;
  await window.electronAPI.savePresentationMarkdown({
    slug,
    mdFile,
    content: previewContent,
    targetFile: tempFile
  });
  if(previewFrame.src === "") {
    const params = new URLSearchParams();
    params.set('p', tempFile);
    params.set('forceControls', '1');
    params.set('builderPreview', '1');
    const ccli = await getPreviewCcliNumber();
    if (ccli) {
      params.set('ccli', ccli);
    }
    if (previewLang) {
      params.set('lang', previewLang);
    }
    const previewUrl = `${getPreviewOrigin()}/${dir}/${slug}/index.html?${params.toString()}`;
    previewFrame.src = previewUrl;
  }
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
  return window.__builderPreviewDeck || null;
}

function attachPreviewBridge() {
  bindPreviewBridgeListener();
}

function startPreviewPolling() {
  bindPreviewBridgeListener();
  if (state.previewPoller) clearInterval(state.previewPoller);
  state.previewReady = false;
  previewBridgeDeck._indices = { h: 0, v: 0 };
  previewBridgeDeck._overview = false;
  sendPreviewCommand('hello');
  state.previewPoller = setInterval(() => {
    if (state.previewReady) {
      clearInterval(state.previewPoller);
      state.previewPoller = null;
      return;
    }
    sendPreviewCommand('hello');
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
