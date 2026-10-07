/*
 * Style tab of the Edit Metadata form (edit mode only): pick font, size, color and weight for headings,
 * paragraphs, lists, quotes, links and code. The choices live in one generated block of the presentation's
 * stylesheet (style.css or the `stylesheet` front-matter value); text outside the block is never touched.
 *
 * Block format and validation: style-block.js. The font list is the universal system fonts plus the bundled fonts in
 * /css/fonts/fonts.json (revelation/css/fonts/fonts.json); picking a bundled font makes style-block.js add an
 * @import of its css to the block. File access: electronAPI.readPresentationStyle /
 * savePresentationStyle (lib/presentationStyle.js). The controls carry no `name`, so none of them end up in the
 * front matter that submitForm builds.
 *
 * Callers: create.js. buildStyleTab() builds the panel, loadStyleTab() reads the file once the metadata is
 * loaded, and saveStyleIfChanged() is called by submitForm before the metadata is saved (it writes nothing
 * when the user did not touch this tab).
 * Gotchas: a color input and a range slider cannot be empty, so "unset" is tracked per row (isColorSet,
 * isSizeSet) and shown as "theme". Loading must wait for the font manifest, so buildStyleTab() is async.
 */
import { t, cloneTemplate, markDirty } from './metadata-form-core.js';
import {
  STYLE_ELEMENTS, SYSTEM_FONTS, FONT_WEIGHTS, FONT_SIZE_MIN, FONT_SIZE_MAX, FONT_SIZE_STEP,
  bundledFonts, parseStyleBlock, mergeStyleBlock
} from './style-block.js';

const DEFAULT_STYLESHEET = 'style.css';

const state = {
  slug: null,
  cssFile: DEFAULT_STYLESHEET,
  note: null,
  fonts: SYSTEM_FONTS, // system fonts plus the bundled ones once fonts.json is loaded
  rows: new Map(), // element key -> { sample, font, size, sizeValue, color, colorState, weight, isSizeSet, isColorSet }
  touched: false
};

// Fill a <select> with a "theme" option, then each group as an <optgroup> of { value, label } options.
function fillSelect(select, groups) {
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = t('Theme default');
  select.appendChild(blank);
  for (const group of groups) {
    const parent = group.label ? document.createElement('optgroup') : select;
    if (group.label) {
      parent.label = t(group.label);
      select.appendChild(parent);
    }
    for (const opt of group.options) {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = group.translate === false ? opt.label : t(opt.label);
      parent.appendChild(el);
    }
  }
}

// Make a bundled font usable by the sample text: add a <link> for its css (once). The Properties window is
// served from the same /css route the presentation uses, so the sample shows the real font.
const loadedFontCss = new Set();
function ensureFontLoaded(font) {
  if (!font || !font.importUrl || loadedFontCss.has(font.importUrl)) return;
  loadedFontCss.add(font.importUrl);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = font.importUrl;
  document.head.appendChild(link);
}

// Load the bundled font list. A missing or broken manifest just leaves only the system fonts.
async function loadBundledFonts() {
  try {
    const res = await fetch('/css/fonts/fonts.json');
    if (res.ok) state.fonts = [...SYSTEM_FONTS, ...bundledFonts(await res.json())];
  } catch (err) {
    console.warn('Could not load fonts.json', err);
  }
}

// Collect the current control values as style-block settings (empty entries are left out).
function readSettings() {
  const settings = {};
  for (const [key, row] of state.rows) {
    const entry = {};
    if (row.font.value) entry.fontFamily = row.font.value;
    if (row.isSizeSet) entry.fontSize = row.size.value;
    if (row.isColorSet) entry.color = row.color.value;
    if (row.weight.value) entry.fontWeight = row.weight.value;
    settings[key] = entry;
  }
  return settings;
}

// Restyle a row's sample text and "theme" label from its controls.
function refreshRow(row) {
  const family = state.fonts.find((f) => f.key === row.font.value);
  const sample = row.sample;
  ensureFontLoaded(family);
  sample.style.fontFamily = family ? family.stack : '';
  sample.style.fontSize = row.isSizeSet ? `${row.size.value}em` : '';
  row.sizeValue.textContent = row.isSizeSet ? `${row.size.value}em` : t('theme');
  sample.style.color = row.isColorSet ? row.color.value : '';
  sample.style.fontWeight = row.weight.value || '';
  row.colorState.textContent = row.isColorSet ? '' : t('theme');
}

function onEdit(row) {
  state.touched = true;
  refreshRow(row);
  markDirty();
}

function setRowValues(row, values = {}) {
  row.font.value = values.fontFamily || '';
  row.isSizeSet = values.fontSize != null;
  row.size.value = row.isSizeSet ? String(values.fontSize) : '1';
  row.isColorSet = !!values.color;
  row.color.value = values.color || '#ffffff';
  row.weight.value = values.fontWeight || '';
  refreshRow(row);
}

// Build the panel into `container`. Call once (and await it) before loadStyleTab().
export async function buildStyleTab(container) {
  await loadBundledFonts();
  const layout = cloneTemplate('tpl-style-layout');
  const body = layout.querySelector('[data-role="rows"]');
  const previewBg = layout.querySelector('[data-role="preview-bg"]');

  for (const el of STYLE_ELEMENTS) {
    const tr = cloneTemplate('tpl-style-row');
    const row = {
      sample: tr.querySelector('[data-role="sample"]'),
      font: tr.querySelector('[data-role="font"]'),
      size: tr.querySelector('[data-role="size"]'),
      sizeValue: tr.querySelector('[data-role="size-value"]'),
      color: tr.querySelector('[data-role="color"]'),
      colorState: tr.querySelector('[data-role="color-state"]'),
      weight: tr.querySelector('[data-role="weight"]'),
      isSizeSet: false,
      isColorSet: false
    };
    row.sample.textContent = t(el.label);
    row.size.min = String(FONT_SIZE_MIN);
    row.size.max = String(FONT_SIZE_MAX);
    row.size.step = String(FONT_SIZE_STEP);
    const bundled = state.fonts.filter((f) => f.importUrl);
    const system = state.fonts.filter((f) => !f.importUrl);
    fillSelect(row.font, [
      { label: 'Bundled fonts', translate: false, options: bundled.map((f) => ({ value: f.key, label: f.label })) },
      { label: 'System fonts', options: system.map((f) => ({ value: f.key, label: f.label })) }
    ].filter((g) => g.options.length));
    fillSelect(row.weight, [{ options: FONT_WEIGHTS.map((w) => ({ value: w.value, label: w.label })) }]);

    row.font.addEventListener('change', () => onEdit(row));
    row.weight.addEventListener('change', () => onEdit(row));
    row.size.addEventListener('input', () => { row.isSizeSet = true; onEdit(row); });
    row.color.addEventListener('input', () => { row.isColorSet = true; onEdit(row); });
    tr.querySelector('[data-role="reset"]').addEventListener('click', () => {
      setRowValues(row);
      onEdit(row);
    });

    state.rows.set(el.key, row);
    refreshRow(row);
    body.appendChild(tr);
  }

  layout.querySelector('[data-role="reset-all"]').addEventListener('click', () => {
    for (const row of state.rows.values()) setRowValues(row);
    state.touched = true;
    markDirty();
  });
  previewBg.addEventListener('input', () => {
    body.querySelectorAll('.style-sample-cell').forEach((cell) => { cell.style.background = previewBg.value; });
  });
  body.querySelectorAll('.style-sample-cell').forEach((cell) => { cell.style.background = previewBg.value; });

  container.appendChild(layout);
  state.note = layout.querySelector('[data-role="note"]');
}

// Read the stylesheet and show its generated block. Failures leave the editor empty and say why.
export async function loadStyleTab(slug, stylesheetName) {
  state.slug = slug;
  state.cssFile = stylesheetName || DEFAULT_STYLESHEET;
  try {
    const parsed = parseStyleBlock(await window.electronAPI.readPresentationStyle(slug, state.cssFile), state.fonts);
    for (const [key, row] of state.rows) setRowValues(row, parsed[key]);
    if (state.note) state.note.textContent = '';
  } catch (err) {
    console.error('Failed to read stylesheet', err);
    if (state.note) state.note.textContent = `${t('Could not read the stylesheet')}: ${err.message || err}`;
  }
  state.touched = false;
}

// Write the stylesheet if the user changed anything here. `stylesheetName` is the form's current
// `stylesheet` value. Throws on failure so submitForm shows the error and stays on the page.
export async function saveStyleIfChanged(stylesheetName) {
  if (!state.touched || !state.slug) return;
  const cssFile = stylesheetName || DEFAULT_STYLESHEET;
  // Re-read so edits made to the file in an external editor while this window was open are kept.
  const current = await window.electronAPI.readPresentationStyle(state.slug, cssFile);
  const next = mergeStyleBlock(current, readSettings(), state.fonts);
  if (next !== current) await window.electronAPI.savePresentationStyle(state.slug, cssFile, next);
  state.cssFile = cssFile;
  state.touched = false;
}
