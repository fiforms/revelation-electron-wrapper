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
function setSaveState(needsSave) {
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
  updateEditExternalState,
  updateOpenFolderState,
  markDirty
};
