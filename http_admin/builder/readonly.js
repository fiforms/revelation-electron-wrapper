/*
 * Read-only mode for a presentation opened from a .revel file (transient slug).
 * Saving is disabled and a banner offers to import the presentation into the library,
 * after which the main process closes this window.
 */
import { slug, saveBtn } from './context.js';

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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installReadOnlyBanner);
} else {
  installReadOnlyBanner();
}

export { isReadOnlyPresentation };
