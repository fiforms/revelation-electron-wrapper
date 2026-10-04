/*
 * Read-only mode for a presentation opened from a .revel file (transient slug).
 * Saving is disabled and a banner offers to import the presentation into the library,
 * after which the main process closes this window.
 */
import { slug, saveBtn, state } from './context.js';
import { addDirtyListener } from './app-state.js';
import { undo } from './history.js';

const OPENED_FILE_SLUG = '_current_open';
const isReadOnlyPresentation = slug === OPENED_FILE_SLUG;

function installReadOnlyBanner() {
  if (!isReadOnlyPresentation || document.getElementById('readonly-banner')) return;

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.title = tr('Read-only: import this presentation to edit it');
  }

  const banner = document.createElement('div');
  banner.id = 'readonly-banner';
  banner.style.cssText = 'position:sticky;top:0;z-index:5000;display:flex;gap:.8rem;align-items:center;'
    + 'padding:.5rem .8rem;background:#33290f;color:#f3e6b5;border-bottom:1px solid #6b5a22;font-size:.9rem;';
  const text = document.createElement('span');
  text.style.flex = '1';
  text.textContent = tr('Read-only: this presentation was opened from a file. Import it into your library to edit it. After importing, changes are saved only in your local library, not back to the original file; export again to update the file.');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary';
  button.textContent = tr('Import to Library');
  button.addEventListener('click', async () => {
    button.disabled = true;
    const result = await window.electronAPI.importOpenedPresentation();
    if (!result?.success) {
      // On success the main process closes this window and reopens the builder on the imported copy.
      button.disabled = false;
      alert(result?.error || tr('Import failed'));
    }
  });
  banner.append(text, button);
  document.body.prepend(banner);
}

// Any edit to a read-only presentation is reverted after reminding the user. Armed only once
// the presentation has loaded, so load-time bookkeeping is not mistaken for an edit.
let armed = false;
let reverting = false;
let reminderQueued = false;
const MAX_UNDO_STEPS = 50;

function revertReadOnlyEdit() {
  reminderQueued = false;
  if (!state.dirty) return;
  reverting = true;
  try {
    window.alert(tr('This presentation is read-only because it was opened from a file. Click "Import to Library" at the top to edit it.'));
    for (let i = 0; i < MAX_UNDO_STEPS && state.dirty; i += 1) undo();
  } finally {
    reverting = false;
  }
  // Something the history did not track: fall back to reloading the unmodified file.
  if (state.dirty) window.location.reload();
}

function armReadOnlyGuard() {
  if (!isReadOnlyPresentation || armed) return;
  armed = true;
  addDirtyListener(() => {
    if (reverting || reminderQueued) return;
    reminderQueued = true;
    // Let the edit finish (and the history record it) before reverting.
    setTimeout(revertReadOnlyEdit, 0);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installReadOnlyBanner);
} else {
  installReadOnlyBanner();
}

export { isReadOnlyPresentation, armReadOnlyGuard };
