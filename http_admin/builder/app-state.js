/*
 * Presentation state helpers for status, save indicators, and action gating.
 *
 * Sections:
 * - Status + save indicators
 * - UI gating helpers
 * - Dirty-state tracking
 */
import {
  tr,
  trFormat,
  statusText,
  saveIndicator,
  saveBtn,
  presentationPropertiesBtn,
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
function setSaveState(needsSave) {
  if (state.columnMarkdownMode) {
    saveBtn.disabled = true;
    saveBtn.textContent = needsSave ? tr('Save Now') : tr('Already Saved');
    return;
  }
  if (needsSave) {
    saveBtn.disabled = false;
    saveBtn.textContent = tr('Save Now');
  } else {
    saveBtn.disabled = true;
    saveBtn.textContent = tr('Already Saved');
  }
}

function updatePresentationPropertiesState() {
  if (!presentationPropertiesBtn) return;
  if (!window.electronAPI?.editPresentationMetadata) {
    presentationPropertiesBtn.disabled = true;
    presentationPropertiesBtn.title = tr('Presentation Properties is only available in the desktop app.');
    return;
  }
  if (!slug || !mdFile) {
    presentationPropertiesBtn.disabled = true;
    presentationPropertiesBtn.title = tr('Missing presentation metadata.');
    return;
  }
  if (state.dirty) {
    presentationPropertiesBtn.disabled = true;
    presentationPropertiesBtn.title = tr('Save the presentation before editing metadata.');
    return;
  }
  presentationPropertiesBtn.disabled = false;
  presentationPropertiesBtn.title = '';
}

function updateOpenFolderState() {
  if (!openPresentationFolderBtn) return;
  if (!window.electronAPI?.showPresentationFolder) {
    openPresentationFolderBtn.disabled = true;
    openPresentationFolderBtn.title = tr('Open Folder is only available in the desktop app.');
    return;
  }
  if (!slug) {
    openPresentationFolderBtn.disabled = true;
    openPresentationFolderBtn.title = tr('Missing presentation metadata.');
    return;
  }
  openPresentationFolderBtn.disabled = false;
  openPresentationFolderBtn.title = '';
}

// --- Dirty-state tracking ---
function markDirty(message = tr('Unsaved changes')) {
  state.dirty = true;
  setSaveIndicator(message);
  setSaveState(true);
  updatePresentationPropertiesState();
}

export {
  setStatus,
  setSaveIndicator,
  setSaveState,
  updatePresentationPropertiesState,
  updateOpenFolderState,
  markDirty
};
