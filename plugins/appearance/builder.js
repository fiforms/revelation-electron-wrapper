import { APPEARANCE_BUILDER_DIALOG_HTML } from './builder-dialog-template.js';

// Build the shortcode token from the current dialog field values.
function buildShortcode(trigger, preset, split, speed, delay) {
  let token = preset;
  if (split)  token += `:${split}`;
  if (speed)  token += `:${speed}`;
  if (delay)  token += `:${delay}`;
  return `${trigger}:${token}`;
}

// Open the animation dialog and append the shortcode to the caret's line.
// Returns a Promise that resolves when the dialog is closed.
export function openAppearanceBuilderDialog(ctx) {
  const existing = document.getElementById('appearance-builder-overlay');
  if (existing) existing.remove();

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'appearance-builder-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(7,10,16,.72);z-index:20000;display:flex;align-items:center;justify-content:center;padding:20px;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'width:min(560px,92vw);max-height:90vh;overflow:auto;background:#161a24;color:#e6e6e6;border:1px solid #303545;border-radius:12px;padding:16px 16px 12px;box-shadow:0 14px 34px rgba(0,0,0,.45);';
    dialog.innerHTML = APPEARANCE_BUILDER_DIALOG_HTML;

    const controlStyle = 'border:1px solid #303545;background:#0f1115;color:#e6e6e6;border-radius:6px;padding:6px 8px;font-size:12px;';
    dialog.querySelectorAll('input, select').forEach((el) => {
      el.style.cssText = controlStyle;
    });
    dialog.querySelectorAll('button').forEach((btn) => {
      const action = btn.getAttribute('data-action');
      const base = 'border:1px solid #303545;background:#1f232d;color:#e6e6e6;border-radius:6px;padding:8px 12px;font-size:12px;cursor:pointer;';
      const primary = 'background:#3b82f6;border-color:#3b82f6;color:#fff;font-weight:600;';
      btn.style.cssText = action === 'insert' ? `${base}${primary}` : base;
    });

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };

    // Live-update the preview shortcode as the user changes fields.
    const previewEl = dialog.querySelector('#appearance-preview');
    const updatePreview = () => {
      const trigger = dialog.querySelector('[name="trigger"]').value;
      const preset  = dialog.querySelector('[name="preset"]').value;
      const split   = dialog.querySelector('[name="split"]').value;
      const speed   = dialog.querySelector('[name="speed"]').value;
      const delay   = String(dialog.querySelector('[name="delay"]').value || '').trim();
      previewEl.textContent = buildShortcode(trigger, preset, split, speed, delay);
    };
    dialog.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('input', updatePreview);
      el.addEventListener('change', updatePreview);
    });
    updatePreview();

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close({ canceled: true });
    });

    dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => close({ canceled: true }));

    dialog.querySelector('[data-action="help"]')?.addEventListener('click', () => {
      if (!window.electronAPI?.openHandoutView) {
        window.alert('Help is only available in the desktop app.');
        return;
      }
      window.electronAPI.openHandoutView('readme', 'plugins-appearance-readme.md').catch((err) => {
        console.error(err);
        window.alert(`Failed to open help: ${err.message || err}`);
      });
    });

    dialog.querySelector('[data-action="insert"]').addEventListener('click', () => {
      const trigger = dialog.querySelector('[name="trigger"]').value;
      const preset  = dialog.querySelector('[name="preset"]').value;
      const split   = dialog.querySelector('[name="split"]').value;
      const speed   = dialog.querySelector('[name="speed"]').value;
      const delay   = String(dialog.querySelector('[name="delay"]').value || '').trim();

      const shortcode = buildShortcode(trigger, preset, split, speed, delay);
      ctx.appendToCurrentLine(shortcode);
      close(undefined);
    });

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}
