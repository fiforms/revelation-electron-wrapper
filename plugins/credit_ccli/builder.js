// plugins/credit_ccli/builder.js  (browser, builder only; lazy-imported by client.js)
// The `:credits:` block dialog. openCreditsDialog() is shared by two callers in client.js:
//   - getBlockTools "CCLI Credits…" (Rich Builder Animation menu): inserts a new block via
//     ctx.appendToSlideEnd.
//   - onRichMacroEdit: edits an existing `:credits:` card through payload.setRaw / remove.
// Block text is read and written by credits-block.js (needs window.jsyaml from builder.html).
// All values go into the DOM through .value / textContent, never innerHTML.
import { parseCreditsBlock, buildCreditsBlock } from './credits-block.js';

const OVERLAY_ID = 'credit-ccli-credits-overlay';

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// [name, label, placeholder] for the plain text fields, in display order.
function textFields() {
  return [
    ['title', tr('Song title'), ''],
    ['words', tr('Words by'), ''],
    ['music', tr('Music by'), ''],
    ['year', tr('Year'), '1981'],
    ['copyright', tr('Copyright holder'), ''],
    ['cclisong', tr('CCLI Song #'), '72439'],
    ['source', tr('Source:'), ''],
    ['sourceurl', tr('Source URL'), 'https://']
  ];
}

// Show the dialog. `initial` is { values, extras, indent } from parseCreditsBlock, or null for
// a new block. Resolves { action: 'apply', block } | { action: 'remove' } | { action: 'cancel' }.
export function openCreditsDialog(initial = null) {
  document.getElementById(OVERLAY_ID)?.remove();
  const yaml = window.jsyaml;
  const editing = !!initial;
  const values = initial?.values || { license: 'ccli' };

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(7,10,16,.72);z-index:20000;display:flex;align-items:center;justify-content:center;padding:20px;';

    const dialog = document.createElement('form');
    dialog.style.cssText = 'width:min(520px,92vw);max-height:90vh;overflow:auto;background:#161a24;color:#e6e6e6;border:1px solid #303545;border-radius:12px;padding:16px 16px 12px;box-shadow:0 14px 34px rgba(0,0,0,.45);font:13px/1.4 sans-serif;';
    const fieldStyle = 'display:flex;flex-direction:column;gap:4px;color:#c4ccda;';
    const controlStyle = 'border:1px solid #303545;background:#0f1115;color:#e6e6e6;border-radius:6px;padding:6px 8px;font-size:12px;';
    dialog.innerHTML = `
      <h3 style="margin:0 0 12px;">${escapeHTML(editing ? tr('Edit Credits') : tr('CCLI Credits'))}</h3>
      <label style="${fieldStyle}margin-bottom:10px;">${escapeHTML(tr('License'))}
        <select name="license" style="${controlStyle}">
          <option value="ccli">${escapeHTML(tr('CCLI'))}</option>
          <option value="public">${escapeHTML(tr('Public Domain'))}</option>
          <option value="">${escapeHTML(tr('Other'))}</option>
        </select>
      </label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        ${textFields().map(([name, label, placeholder]) => `
          <label style="${fieldStyle}" data-field="${name}">${escapeHTML(label)}
            <input type="text" name="${name}" placeholder="${escapeHTML(placeholder)}" style="${controlStyle}">
          </label>`).join('')}
      </div>
      <label style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
        <input type="checkbox" name="attrib">
        <span>${escapeHTML(tr('Show copyright on every following slide'))}</span>
      </label>
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        ${editing ? `<button type="button" data-action="remove" style="margin-right:auto;">${escapeHTML(tr('Remove Credits'))}</button>` : ''}
        <button type="button" data-action="cancel">${escapeHTML(tr('Cancel'))}</button>
        <button type="submit" data-action="apply">${escapeHTML(editing ? tr('Apply') : tr('Insert'))}</button>
      </div>`;

    const field = (name) => dialog.querySelector(`[name="${name}"]`);
    textFields().forEach(([name]) => { field(name).value = values[name] || ''; });
    field('license').value = ['ccli', 'public'].includes(values.license) ? values.license : '';
    field('attrib').checked = !!values.attrib;

    // The CCLI song number only applies to CCLI songs.
    const syncLicense = () => {
      dialog.querySelector('[data-field="cclisong"]').style.display = field('license').value === 'ccli' ? '' : 'none';
    };
    field('license').addEventListener('change', syncLicense);
    syncLicense();

    dialog.querySelectorAll('button').forEach((btn) => {
      const action = btn.getAttribute('data-action');
      const base = 'border:1px solid #303545;background:#1f232d;color:#e6e6e6;border-radius:6px;padding:8px 12px;font-size:12px;cursor:pointer;';
      const primary = 'background:#3b82f6;border-color:#3b82f6;color:#fff;font-weight:600;';
      btn.style.cssText = action === 'apply' ? `${base}${primary}` : base;
    });

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close({ action: 'cancel' });
    });
    dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => close({ action: 'cancel' }));
    dialog.querySelector('[data-action="remove"]')?.addEventListener('click', () => close({ action: 'remove' }));
    dialog.addEventListener('submit', (event) => {
      event.preventDefault();
      const next = { attrib: field('attrib').checked, license: field('license').value };
      textFields().forEach(([name]) => { next[name] = field(name).value; });
      if (next.license !== 'ccli') next.cclisong = '';
      close({
        action: 'apply',
        block: buildCreditsBlock(next, yaml, { extras: initial?.extras, indent: initial?.indent })
      });
    });

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    field('license').focus();
  });
}

// Animation-menu entry: ask for the credits, then add the block at the end of the slide.
export async function insertCreditsBlock(ctx) {
  if (!window.jsyaml) return;
  const result = await openCreditsDialog();
  if (result.action === 'apply') ctx.appendToSlideEnd(result.block);
}

// onRichMacroEdit handler for a `:credits:` card. Returns false when the block can't be
// parsed so the host falls back to its plain-text editor.
export async function editCreditsCard(payload) {
  if (!window.jsyaml) return false;
  const initial = parseCreditsBlock(payload.raw, window.jsyaml);
  if (!initial) return false;
  const result = await openCreditsDialog(initial);
  if (result.action === 'apply') payload.setRaw(result.block);
  else if (result.action === 'remove') payload.remove();
  return true;
}
