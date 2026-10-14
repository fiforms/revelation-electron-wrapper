// plugins/appearance/builder.js  (browser, builder only; lazy-imported by client.js getSlideTools)
// Animation dialog: builds the shortcode and appends it to the caret line via ctx.appendToCurrentLine.
import { APPEARANCE_BUILDER_DIALOG_HTML } from './builder-dialog-template.js';

// Build the shortcode token from the current dialog field values.
function buildShortcode(trigger, preset, split, speed, delay) {
  // No animation: a plain fragment (click to reveal), whatever the trigger says.
  if (!preset) return '++';
  let token = preset;
  if (split)  token += `:${split}`;
  if (speed)  token += `:${speed}`;
  if (delay)  token += `:${delay}`;
  return `${trigger}:${token}`;
}

const SAMPLE_TEXT = 'Sample text';

// Per-piece delays (ms) for letter/word splitting. Matches reveal-appearance:
// with a split, the delay field is the gap between pieces (default 300ms), and
// the first piece starts immediately.
export function splitDelays(text, mode, step = 300) {
  const pieces = mode === 'let' ? Array.from(text) : text.split(/(\s+)/);
  let n = 0;
  return pieces.map((piece) => {
    if (!piece.trim()) return { piece, delay: null };
    return { piece, delay: (n++) * step };
  });
}

// Replay the chosen animation on the sample element using the plugin's own
// animate.css class tables (client.js getPreviewClasses). Needs appearance.css,
// which client.js init() injects into the builder page.
function playPreview(sampleEl, { preset, split, speed, delay }) {
  const plugin = window.RevelationPlugins?.appearance;
  if (!document.getElementById('appearance-css') && plugin?.context?.baseURL) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.id = 'appearance-css';
    link.href = `${plugin.context.baseURL}/appearance/appearance.css`;
    document.head.appendChild(link);
  }
  const { presetClass, speedClass } = plugin?.getPreviewClasses?.({ preset, speed }) || {};
  // The box stays put; only the text inside animates.
  sampleEl.textContent = '';
  const textEl = document.createElement('div');
  textEl.textContent = SAMPLE_TEXT;
  sampleEl.appendChild(textEl);
  if (!presetClass) return; // "None": plain fragment, nothing to animate
  const baseDelay = parseInt(delay, 10) || 0;
  const animate = (el, ms) => {
    el.className = `animate__animated ${presetClass} ${speedClass}`.trim();
    el.style.animationDelay = `${ms}ms`;
  };
  if (!split) {
    animate(textEl, baseDelay);
    return;
  }
  textEl.textContent = '';
  splitDelays(SAMPLE_TEXT, split, baseDelay || 300).forEach(({ piece, delay: ms }) => {
    const span = document.createElement('span');
    span.textContent = piece;
    span.style.display = 'inline-block';
    span.style.whiteSpace = 'pre';
    if (ms !== null) animate(span, ms);
    textEl.appendChild(span);
  });
}

// Split an existing marker (`++`, `++:drop:let:slow:500`) into dialog fields.
// Unknown pieces are ignored; a bare marker means "no animation".
export function parseShortcode(marker) {
  const [trigger = '++', ...rest] = String(marker || '').trim().split(':');
  const fields = { trigger: trigger === '==' ? '==' : '++', preset: '', split: '', speed: '', delay: '' };
  rest.forEach((part, i) => {
    if (i === 0 && !/^\d+$/.test(part) && !['let', 'word', 'slow', 'fast'].includes(part)) fields.preset = part;
    else if (part === 'let' || part === 'word') fields.split = part;
    else if (part === 'slow' || part === 'fast') fields.speed = part;
    else if (/^\d+$/.test(part)) fields.delay = part;
  });
  return fields;
}

// Open the animation dialog and append the shortcode to the caret's line.
// With `edit` ({ marker, setMarker, remove } from the rich editor's
// onRichFragmentEdit hook) it edits that fragment instead.
// Returns a Promise that resolves when the dialog is closed.
export function openAppearanceBuilderDialog(ctx, edit = null) {
  const existing = document.getElementById('appearance-builder-overlay');
  if (existing) existing.remove();

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'appearance-builder-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(7,10,16,.72);z-index:20000;display:flex;align-items:center;justify-content:center;padding:20px;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'width:min(560px,92vw);max-height:90vh;overflow:auto;background:#161a24;color:#e6e6e6;border:1px solid #303545;border-radius:12px;padding:16px 16px 12px;box-shadow:0 14px 34px rgba(0,0,0,.45);';
    dialog.innerHTML = APPEARANCE_BUILDER_DIALOG_HTML;

    // "None" = a plain fragment: no animation, so the other fields don't apply.
    const presetSelect = dialog.querySelector('[name="preset"]');
    presetSelect.insertAdjacentHTML('afterbegin', '<option value="">None — plain fragment (no animation)</option>');
    const fieldNames = ['trigger', 'split', 'speed', 'delay'];
    const syncNone = () => {
      const none = !presetSelect.value;
      fieldNames.forEach((name) => { dialog.querySelector(`[name="${name}"]`).disabled = none; });
    };
    if (edit) {
      const fields = parseShortcode(edit.marker);
      if (fields.preset && ![...presetSelect.options].some((o) => o.value === fields.preset)) {
        presetSelect.add(new Option(fields.preset, fields.preset));
      }
      Object.entries(fields).forEach(([name, value]) => { dialog.querySelector(`[name="${name}"]`).value = value; });
      dialog.querySelector('h3').textContent = 'Edit Animation';
      dialog.querySelector('#appearance-preview').previousElementSibling.textContent = 'Fragment marker:';
      const insertBtn = dialog.querySelector('[data-action="insert"]');
      insertBtn.textContent = 'Apply';
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.setAttribute('data-action', 'remove');
      removeBtn.textContent = 'Remove Fragment';
      removeBtn.style.marginRight = 'auto';
      insertBtn.parentElement.prepend(removeBtn);
    }

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
      syncNone();
      // With a split, the delay is the gap between pieces (default 300ms);
      // otherwise it is a single start delay (default 0).
      dialog.querySelector('[name="delay"]').placeholder = split ? 'default 300' : 'default 0';
      replay();
    };
    const sampleEl = dialog.querySelector('#appearance-sample');
    const replay = () => {
      playPreview(sampleEl, {
        preset: dialog.querySelector('[name="preset"]').value,
        split: dialog.querySelector('[name="split"]').value,
        speed: dialog.querySelector('[name="speed"]').value,
        delay: dialog.querySelector('[name="delay"]').value
      });
    };
    dialog.querySelector('[data-action="replay"]').addEventListener('click', replay);
    dialog.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('input', updatePreview);
      el.addEventListener('change', updatePreview);
    });
    updatePreview();

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close({ canceled: true });
    });

    dialog.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
      edit.remove();
      close(undefined);
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
      if (edit) {
        edit.setMarker(shortcode);
        close(undefined);
        return;
      }
      ctx.appendToCurrentLine(shortcode);
      close(undefined);
    });

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}
