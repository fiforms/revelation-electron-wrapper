/*
 * Presentation state helpers for status, save indicators, and action gating.
 *
 * Sections:
 * - Status + save indicators
 * - UI gating helpers
 * - Dirty-state tracking
 *
 * markDirty() is the single funnel for "the document changed": it sets state.dirty,
 * updates the Save button, emits the host event 'document:changed' (extensions-host.js)
 * and runs dirty listeners. Listeners registered here: history.js (undo snapshots),
 * preview.js (auto-unlink from peers) and readonly.js (revert edits in read-only mode).
 */
import {
  trFormat,
  statusText,
  saveIndicator,
  saveBtn,
  presentationPropertiesBtn,
  editExternalBtn,
  openPresentationFolderBtn,
  slug,
  mdFile,
  state
} from './context.js';

// --- Status + save indicators ---
function setStatus(message) {
  statusText.textContent = message;
}

function setSaveIndicator(message) {
  saveIndicator.textContent = message;
}

// --- UI gating helpers ---
// Set the Save button's text, keeping its icon.
function setSaveButtonLabel(text) {
  const label = saveBtn.querySelector('.save-btn-label') || saveBtn;
  label.textContent = text;
}

function setSaveState(needsSave) {
  saveBtn.disabled = !needsSave;
  setSaveButtonLabel(needsSave ? tr('Save Now') : tr('Already Saved'));
}

function updatePresentationPropertiesState() {
  if (!presentationPropertiesBtn) return;
  const setDisabled = (disabled, title) => {
    presentationPropertiesBtn.disabled = disabled;
    presentationPropertiesBtn.classList.toggle('is-disabled', disabled);
    presentationPropertiesBtn.title = title || '';
  };
  if (!window.electronAPI?.editPresentationMetadata) {
    setDisabled(true, tr('Presentation Properties is only available in the desktop app.'));
    return;
  }
  if (!slug || !mdFile) {
    setDisabled(true, tr('Missing presentation metadata.'));
    return;
  }
  if (state.dirty) {
    setDisabled(true, tr('Save the presentation before editing metadata.'));
    return;
  }
  setDisabled(false, '');
}

function updateOpenFolderState() {
  if (!openPresentationFolderBtn) return;
  const setDisabled = (disabled, title) => {
    openPresentationFolderBtn.disabled = disabled;
    openPresentationFolderBtn.classList.toggle('is-disabled', disabled);
    openPresentationFolderBtn.title = title || '';
  };
  if (!window.electronAPI?.showPresentationFolder) {
    setDisabled(true, tr('Open Folder is only available in the desktop app.'));
    return;
  }
  if (!slug) {
    setDisabled(true, tr('Missing presentation metadata.'));
    return;
  }
  setDisabled(false, '');
}

function updateEditExternalState() {
  if (!editExternalBtn) return;
  const setDisabled = (disabled, title) => {
    editExternalBtn.disabled = disabled;
    editExternalBtn.classList.toggle('is-disabled', disabled);
    editExternalBtn.title = title || '';
  };
  if (!window.electronAPI?.editPresentation || !window.electronAPI?.openPresentation) {
    setDisabled(true, tr('Edit External is only available in the desktop app.'));
    return;
  }
  if (!slug || !mdFile) {
    setDisabled(true, tr('Missing presentation metadata.'));
    return;
  }
  setDisabled(false, '');
}

// --- Dirty-state tracking ---
const _dirtyListeners = [];

function addDirtyListener(fn) {
  if (typeof fn === 'function') _dirtyListeners.push(fn);
}

function markDirty(message = tr('Unsaved changes')) {
  state.dirty = true;
  setSaveIndicator(message);
  setSaveState(true);
  updatePresentationPropertiesState();
  if (typeof window.__revelationBuilderHostInternalEmit === 'function') {
    window.__revelationBuilderHostInternalEmit('document:changed', {
      dirty: true,
      source: 'builder'
    });
  }
  for (const fn of _dirtyListeners) {
    try { fn(); } catch (e) { console.warn('dirtyListener error', e); }
  }
}

// Transient bottom-of-window toast (keyboard-shortcut hints, host.notify()).
function showBuilderToast(message) {
  const existing = document.getElementById('builder-kb-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'builder-kb-toast';
  toast.textContent = message;
  toast.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);max-width:min(90vw,600px);padding:10px 16px;border-radius:8px;background:rgba(20,20,20,0.92);color:#fff;font:13px/1.4 system-ui,sans-serif;z-index:2147483647;box-shadow:0 8px 24px rgba(0,0,0,0.3);opacity:0;transition:opacity 160ms ease';
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3200);
}

export {
  setStatus,
  showBuilderToast,
  setSaveIndicator,
  setSaveState,
  setSaveButtonLabel,
  updatePresentationPropertiesState,
  updateEditExternalState,
  updateOpenFolderState,
  markDirty,
  addDirtyListener
};
