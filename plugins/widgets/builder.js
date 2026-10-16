// plugins/widgets/builder.js  (browser, builder only; lazy-imported by client.js)
// The `:widget:` block dialog. openWidgetDialog() is shared by two callers in client.js:
//   - getBlockTools "Overlay Widget…" (Rich Builder Animation menu): inserts a new block via
//     ctx.appendToSlideEnd.
//   - onRichMacroEdit: edits an existing `:widget:` card through payload.setRaw / remove.
// The option fields are generated from each widget's manifest.json `parameters` (type, label,
// help, default, min/max/step, options) and checked with the same validate.js the presenter
// uses. Block text is read and written by widget-block.js (needs window.jsyaml).
// All values go into the DOM through .value / textContent, never innerHTML.
import { parseWidgetBlock, buildWidgetBlock } from './widget-block.js';

const OVERLAY_ID = 'widgets-block-overlay';
const REF_W = 1920; // widgets are authored in a 1920x1080 space; manifests give defaultSize in it
const REF_H = 1080;

const FIELD = 'display:flex;flex-direction:column;gap:4px;color:#c4ccda;';
const CONTROL = 'border:1px solid #303545;background:#0f1115;color:#e6e6e6;border-radius:6px;padding:6px 8px;font-size:12px;';
const BUTTON = 'border:1px solid #303545;background:#1f232d;color:#e6e6e6;border-radius:6px;padding:8px 12px;font-size:12px;cursor:pointer;';
const PRIMARY = 'background:#3b82f6;border-color:#3b82f6;color:#fff;font-weight:600;';
const HELP = 'color:#8b94a7;font-size:11px;';
const SECTION = 'margin:0 0 6px;font-size:12px;font-weight:600;color:#e6e6e6;';

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'style') node.style.cssText = value;
    else if (key === 'text') node.textContent = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child) node.appendChild(child);
  return node;
}

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const pct = (ratio) => String(Math.round(ratio * 1000) / 10); // 0.2345 -> "23.5"

// "#abc" / "#aabbcc" / "#aabbccdd" -> "#aabbcc" for <input type=color>; null if not a hex color.
function hexForPicker(value) {
  const c = String(value || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  if (/^#[0-9a-f]{3}$/.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  if (/^#[0-9a-f]{8}$/.test(c)) return c.slice(0, 7);
  return null;
}

// The value a parameter should be written as, or undefined to leave it out (blank or default).
function writableValue(def, value) {
  if (value === undefined || value === null || value === '') return undefined;
  let out;
  if (def.type === 'number') {
    out = Number(value);
    if (!Number.isFinite(out)) return undefined;
  } else if (def.type === 'boolean') {
    out = value === true || value === 'true';
  } else {
    out = String(value);
  }
  if (def.default !== undefined && String(def.default) === String(out)) return undefined;
  if (def.default === undefined && def.type === 'boolean' && out === false) return undefined;
  return out;
}

// One input for a manifest parameter. Writes changes into state.params[name].
function paramControl(name, def, state) {
  const current = state.params[name];
  const onChange = (value) => { state.params[name] = value; };
  const placeholder = def.default !== undefined ? String(def.default) : '';

  if (def.type === 'boolean') {
    const box = el('input', { type: 'checkbox', checked: current === undefined ? def.default === true : (current === true || current === 'true') });
    box.addEventListener('change', () => onChange(box.checked));
    return { input: box, inline: true };
  }
  if (def.type === 'enum') {
    const select = el('select', { style: CONTROL });
    if (def.default === undefined) select.appendChild(el('option', { value: '', text: '' }));
    for (const option of def.options || []) select.appendChild(el('option', { value: String(option), text: String(option) }));
    select.value = String(current ?? def.default ?? '');
    select.addEventListener('change', () => onChange(select.value));
    return { input: select };
  }
  if (def.type === 'color') {
    // The picker only emits on change, so a color the picker can't show (e.g. #rrggbbaa) survives untouched.
    const picker = el('input', { type: 'color', style: 'width:48px;height:28px;padding:0;border:1px solid #303545;border-radius:6px;background:#0f1115;' });
    picker.value = hexForPicker(current) || hexForPicker(def.default) || '#ffffff';
    picker.addEventListener('input', () => onChange(picker.value));
    return { input: picker };
  }
  if (def.type === 'text') {
    const area = el('textarea', { rows: 3, style: `${CONTROL}resize:vertical;`, placeholder });
    area.value = current === undefined ? '' : String(current);
    area.addEventListener('input', () => onChange(area.value));
    return { input: area };
  }
  const input = el('input', { type: def.type === 'number' ? 'number' : 'text', style: CONTROL, placeholder: def.type === 'url' ? (placeholder || 'https://') : placeholder });
  if (def.type === 'number') {
    if (def.min !== undefined) input.min = def.min;
    if (def.max !== undefined) input.max = def.max;
    if (def.step !== undefined) input.step = def.step;
  } else if (def.maxLength) {
    input.maxLength = def.maxLength;
  }
  input.value = current === undefined ? '' : String(current);
  input.addEventListener('input', () => onChange(input.value));
  return { input };
}

// Show the dialog. `initial` is the object from parseWidgetBlock, or null for a new block.
// `host` is the widgets plugin object (baseURL, ready, validate, loadManifest); `ids` the widget
// ids to offer. Resolves { action: 'apply', block } | { action: 'remove' } | { action: 'cancel' }.
export async function openWidgetDialog(host, ids, initial = null) {
  document.getElementById(OVERLAY_ID)?.remove();
  const yaml = window.jsyaml;
  const editing = !!initial;
  await host.ready;

  const manifests = new Map();
  const widgetIds = [...new Set([...(initial?.name ? [initial.name] : []), ...ids])];
  await Promise.all(widgetIds.map(async (id) => {
    try { manifests.set(id, await host.loadManifest(id)); } catch { /* unknown widget: not offered */ }
  }));
  if (!manifests.size) return { action: 'cancel' };

  const state = {
    name: manifests.has(initial?.name) ? initial.name : [...manifests.keys()][0],
    x: initial?.x ?? null, y: initial?.y ?? null, w: initial?.w ?? null, h: initial?.h ?? null,
    params: { ...(initial?.parameters || {}) },
    location: { name: initial?.location?.name ?? '', latitude: initial?.location?.latitude ?? '', longitude: initial?.location?.longitude ?? '' }
  };
  const manifest = () => manifests.get(state.name);
  const defaultRatio = () => {
    const size = manifest().defaultSize || { w: 400, h: 300 };
    return { w: clamp(size.w / REF_W, 0.01, 1), h: clamp(size.h / REF_H, 0.01, 1) };
  };
  // New blocks (and a switched widget) start at the widget's default size, top-left at 3%.
  const applyDefaultLayout = () => {
    const d = defaultRatio();
    Object.assign(state, { x: state.x ?? 0.03, y: state.y ?? 0.04, w: d.w, h: d.h });
  };
  if (!editing) applyDefaultLayout();
  else {
    const d = defaultRatio();
    state.x ??= 0; state.y ??= 0; state.w ??= d.w; state.h ??= d.h;
  }

  return new Promise((resolve) => {
    const overlay = el('div', { id: OVERLAY_ID, style: 'position:fixed;inset:0;background:rgba(7,10,16,.72);z-index:20000;display:flex;align-items:center;justify-content:center;padding:20px;' });
    const dialog = el('form', { style: 'width:min(560px,94vw);max-height:90vh;overflow:auto;background:#161a24;color:#e6e6e6;border:1px solid #303545;border-radius:12px;padding:16px 16px 12px;box-shadow:0 14px 34px rgba(0,0,0,.45);font:13px/1.4 sans-serif;' });

    // --- widget picker -----------------------------------------------------------------------
    const select = el('select', { style: CONTROL });
    for (const [id, m] of manifests) select.appendChild(el('option', { value: id, text: m.name || id }));
    select.value = state.name;
    const icon = el('img', { alt: '', style: 'width:44px;height:44px;border-radius:8px;object-fit:cover;background:#0f1115;border:1px solid #303545;flex:none;' });
    const description = el('div', { style: HELP });
    const picker = el('div', { style: 'display:flex;gap:12px;align-items:center;margin-bottom:14px;' }, [
      icon,
      el('label', { style: `${FIELD}flex:1;` }, [el('span', { text: tr('Widget') }), select, description])
    ]);

    // --- layout: drag preview + percent fields ------------------------------------------------
    const rect = el('div', { style: 'position:absolute;border:2px solid #3b82f6;background:rgba(59,130,246,.28);border-radius:3px;cursor:move;box-sizing:border-box;touch-action:none;' });
    const stage = el('div', { style: 'position:relative;aspect-ratio:16/9;background:#0f1115;border:1px solid #303545;border-radius:6px;overflow:hidden;margin-bottom:8px;' }, [rect]);
    const layoutInputs = {};
    const layoutRow = el('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:10px;' });
    for (const [key, label] of [['x', tr('Left %')], ['y', tr('Top %')], ['w', tr('Width %')], ['h', tr('Height %')]]) {
      const input = el('input', { type: 'number', min: 0, max: 100, step: 'any', style: CONTROL });
      layoutInputs[key] = input;
      input.addEventListener('input', () => {
        const n = Number(input.value);
        if (input.value !== '' && Number.isFinite(n)) state[key] = clamp(n, 0, 100) / 100;
        paintRect();
      });
      layoutRow.appendChild(el('label', { style: FIELD }, [el('span', { text: label }), input]));
    }
    const paintRect = () => {
      const w = clamp(state.w ?? 0, 0.01, 1);
      const h = clamp(state.h ?? 0, 0.01, 1);
      Object.assign(rect.style, {
        left: `${clamp(state.x ?? 0, 0, 1) * 100}%`, top: `${clamp(state.y ?? 0, 0, 1) * 100}%`,
        width: `${w * 100}%`, height: `${h * 100}%`
      });
    };
    const syncLayoutInputs = () => {
      for (const key of ['x', 'y', 'w', 'h']) layoutInputs[key].value = pct(state[key]);
      paintRect();
    };
    // Bottom-right corner handle resizes; the rest of the box moves it.
    const handle = el('div', { style: 'position:absolute;right:-1px;bottom:-1px;width:14px;height:14px;background:#3b82f6;border-radius:3px 0 3px 0;cursor:nwse-resize;' });
    rect.appendChild(handle);
    rect.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      rect.setPointerCapture(event.pointerId);
      const resizing = event.target === handle;
      const box = stage.getBoundingClientRect();
      const start = { px: event.clientX, py: event.clientY, x: state.x, y: state.y, w: state.w, h: state.h };
      const move = (e) => {
        const dx = (e.clientX - start.px) / box.width;
        const dy = (e.clientY - start.py) / box.height;
        if (resizing) {
          state.w = clamp(start.w + dx, 0.02, Math.max(0.02, 1 - state.x));
          state.h = clamp(start.h + dy, 0.02, Math.max(0.02, 1 - state.y));
        } else {
          state.x = clamp(start.x + dx, 0, Math.max(0, 1 - state.w));
          state.y = clamp(start.y + dy, 0, Math.max(0, 1 - state.h));
        }
        syncLayoutInputs();
      };
      const stop = () => {
        rect.removeEventListener('pointermove', move);
        rect.removeEventListener('pointerup', stop);
        rect.removeEventListener('pointercancel', stop);
      };
      rect.addEventListener('pointermove', move);
      rect.addEventListener('pointerup', stop);
      rect.addEventListener('pointercancel', stop);
    });
    const layoutSection = el('div', { style: 'margin-bottom:14px;' }, [
      el('div', { style: SECTION, text: tr('Position and size on the slide') }),
      stage, layoutRow,
      el('div', { style: `${HELP}margin-top:4px;`, text: tr('Drag the box to move it, or its corner to resize. Values are a percentage of the slide.') })
    ]);

    // --- options (generated from the manifest) ---------------------------------------------------
    const optionsBox = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px;' });
    const optionsSection = el('div', { style: 'margin-bottom:14px;' }, [el('div', { style: SECTION, text: tr('Options') }), optionsBox]);
    const labelFor = {};
    const renderOptions = () => {
      optionsBox.replaceChildren();
      for (const key of Object.keys(labelFor)) delete labelFor[key];
      const params = manifest().parameters || {};
      const names = Object.keys(params);
      optionsSection.style.display = names.length ? '' : 'none';
      for (const name of names) {
        const def = params[name];
        const { input, inline } = paramControl(name, def, state);
        const wide = def.type === 'text' || def.type === 'url' || def.help || def.type === 'string' && (def.maxLength || 0) > 20;
        const label = el('label', {
          style: inline ? 'display:flex;gap:8px;align-items:center;color:#c4ccda;' : FIELD
        }, inline
          ? [input, el('span', { text: def.label || name })]
          : [el('span', { text: def.label || name }), input]);
        if (def.help) label.appendChild(el('span', { style: HELP, text: def.help }));
        label.style.gridColumn = wide ? '1 / -1' : 'auto';
        labelFor[name] = label;
        optionsBox.appendChild(label);
      }
    };

    // --- location (only for widgets that can use it) ---------------------------------------------
    const locInputs = {};
    const locRow = el('div', { style: 'display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;' });
    for (const [key, label, type] of [['name', tr('Place name'), 'text'], ['latitude', tr('Latitude'), 'number'], ['longitude', tr('Longitude'), 'number']]) {
      const input = el('input', { type, style: CONTROL });
      if (type === 'number') input.step = 'any';
      input.value = String(state.location[key] ?? '');
      input.addEventListener('input', () => { state.location[key] = input.value; });
      locInputs[key] = input;
      locRow.appendChild(el('label', { style: FIELD }, [el('span', { text: label }), input]));
    }
    const locationSection = el('div', { style: 'margin-bottom:14px;' }, [
      el('div', { style: SECTION, text: tr('Location (optional)') }),
      locRow,
      el('div', { style: `${HELP}margin-top:4px;`, text: tr('Used when the widget has no place of its own, such as a blank ZIP code in Weather.') })
    ]);

    const error = el('div', { style: 'color:#f87171;font-size:12px;margin-bottom:10px;min-height:0;' });

    const refreshWidget = () => {
      const m = manifest();
      icon.src = m.icon ? `${host.baseURL}/overlaywidgets/${state.name}/${m.icon}` : '';
      icon.style.visibility = m.icon ? 'visible' : 'hidden';
      description.textContent = m.description || '';
      locationSection.style.display = m.usesLocation || initial?.location ? '' : 'none';
      error.textContent = '';
      renderOptions();
      syncLayoutInputs();
    };
    select.addEventListener('change', () => {
      state.name = select.value;
      applyDefaultLayout();
      refreshWidget();
    });

    // --- buttons -----------------------------------------------------------------------------------
    const cancelBtn = el('button', { type: 'button', style: BUTTON, text: tr('Cancel') });
    const removeBtn = editing ? el('button', { type: 'button', style: `${BUTTON}margin-right:auto;`, text: tr('Remove Widget') }) : null;
    const applyBtn = el('button', { type: 'submit', style: BUTTON + PRIMARY, text: editing ? tr('Apply') : tr('Insert') });
    const buttons = el('div', { style: 'display:flex;justify-content:flex-end;gap:10px;' }, [removeBtn, cancelBtn, applyBtn]);

    dialog.append(
      el('h3', { style: 'margin:0 0 12px;', text: editing ? tr('Edit Widget') : tr('Overlay Widget') }),
      picker, layoutSection, optionsSection, locationSection, error, buttons
    );

    const close = (result) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close({ action: 'cancel' });
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close({ action: 'cancel' });
    });
    cancelBtn.addEventListener('click', () => close({ action: 'cancel' }));
    removeBtn?.addEventListener('click', () => close({ action: 'remove' }));

    dialog.addEventListener('submit', (event) => {
      event.preventDefault();
      const m = manifest();
      const params = {};
      for (const [name, def] of Object.entries(m.parameters || {})) {
        const value = writableValue(def, state.params[name]);
        labelFor[name].style.color = '';
        if (value === undefined) continue;
        try {
          host.validate?.validateValue(def, value, 'invalid_params');
        } catch {
          labelFor[name].style.color = '#f87171';
          error.textContent = `${tr('Check this option:')} ${def.label || name}`;
          labelFor[name].scrollIntoView?.({ block: 'nearest' });
          return;
        }
        params[name] = value;
      }
      // Keep options this dialog doesn't know about when the widget is unchanged.
      if (state.name === initial?.name) {
        for (const [name, value] of Object.entries(initial.parameters)) if (!(name in (m.parameters || {}))) params[name] = value;
      }
      const lat = state.location.latitude;
      const lon = state.location.longitude;
      const hasLoc = (lat !== '' && lat !== null) || (lon !== '' && lon !== null);
      if (hasLoc && !(Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180 && lat !== '' && lon !== '')) {
        error.textContent = tr('Latitude must be -90 to 90 and longitude -180 to 180.');
        return;
      }
      close({
        action: 'apply',
        block: buildWidgetBlock({
          name: state.name, x: state.x, y: state.y, w: state.w, h: state.h,
          location: hasLoc ? state.location : null,
          parameters: params
        }, yaml, { extras: initial?.extras, indent: initial?.indent })
      });
    });

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    refreshWidget();
    select.focus();
  });
}

// Animation-menu entry: ask for the widget, then add the block at the end of the slide.
export async function insertWidgetBlock(host, ids, ctx) {
  if (!window.jsyaml) return;
  const result = await openWidgetDialog(host, ids);
  if (result.action === 'apply') ctx.appendToSlideEnd(result.block);
}

// onRichMacroEdit handler for a `:widget:` card. Returns false when the block can't be parsed
// or names an unknown widget so the host falls back to its plain-text editor.
export async function editWidgetCard(host, ids, payload) {
  if (!window.jsyaml) return false;
  const initial = parseWidgetBlock(payload.raw, window.jsyaml);
  if (!initial) return false;
  try { await host.loadManifest(initial.name); } catch { return false; }
  const result = await openWidgetDialog(host, ids, initial);
  if (result.action === 'apply') payload.setRaw(result.block);
  else if (result.action === 'remove') payload.remove();
  return true;
}
