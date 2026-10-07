/*
 * Style tab of the Edit Metadata form (edit mode only): pick font, size, color, weight, italics and UPPERCASE for
 * headings, paragraphs, lists, quotes, links and code, and set the default slide background. The choices live in one
 * generated block of the presentation's stylesheet (style.css or the `stylesheet` front-matter value); text outside
 * the block is never touched.
 *
 * Block format and validation: style-block.js. The font list is the universal system fonts plus the bundled fonts in
 * /css/fonts/fonts.json (revelation/css/fonts/fonts.json); picking a bundled font makes style-block.js add an
 * @import of its css to the block. Colours use the shared picker (../shared/gradient-picker.js): the slide background
 * with alpha off and gradients on, text colours with alpha on and gradients only on the heading rows
 * (STYLE_ELEMENTS gradientText). File access: electronAPI.readPresentationStyle / savePresentationStyle
 * (lib/presentationStyle.js). The controls carry no `name`, so none of them end up in the front matter that
 * submitForm builds.
 *
 * Callers: create.js. buildStyleTab() builds the panel, loadStyleTab() reads the file once the metadata is
 * loaded, and saveStyleIfChanged() is called by submitForm before the metadata is saved (it writes nothing
 * when the user did not touch this tab).
 * Gotchas: a range slider and the picker cannot be empty, so "unset" is tracked per row (colorValue '', isSizeSet)
 * and shown as "theme". A row's colour picker is mounted the first time its swatch is opened. Loading must wait
 * for the font manifest, so buildStyleTab() is async.
 */
import { t, cloneTemplate, markDirty } from './metadata-form-core.js';
import { mountGradientPicker } from '../shared/gradient-picker.js';
import {
  STYLE_ELEMENTS, SYSTEM_FONTS, FONT_WEIGHTS, FONT_STYLES, TEXT_TRANSFORMS, FONT_SIZE_MIN, FONT_SIZE_MAX, FONT_SIZE_STEP,
  bundledFonts, cleanTextColor, isGradientColor, parseStyleBlock, mergeStyleBlock
} from './style-block.js';

const DEFAULT_STYLESHEET = 'style.css';

const state = {
  slug: null,
  cssFile: DEFAULT_STYLESHEET,
  note: null,
  fonts: SYSTEM_FONTS, // system fonts plus the bundled ones once fonts.json is loaded
  background: null, // { picker, swatch, stateLabel, isSet, cells } for the slide background control
  rows: new Map(), // element key -> { sample, font, size, sizeValue, colorSwatch, colorState, colorPanel, colorHost, colorPicker, colorValue, allowGradient, weight, fontStyle, textTransform, isSizeSet }
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
    if (row.colorValue) entry.color = row.colorValue;
    if (row.weight.value) entry.fontWeight = row.weight.value;
    if (row.fontStyle.value) entry.fontStyle = row.fontStyle.value;
    if (row.textTransform.value) entry.textTransform = row.textTransform.value;
    settings[key] = entry;
  }
  if (state.background && state.background.isSet) settings.background = state.background.picker.getValue();
  return settings;
}

// Show a colour on the sample text: a solid colour, or a gradient clipped to the letters (like the real CSS).
function applyTextColor(sample, value) {
  const style = sample.style;
  style.color = '';
  style.background = '';
  style.backgroundClip = '';
  style.webkitBackgroundClip = '';
  style.webkitTextFillColor = '';
  if (!value) return;
  if (isGradientColor(value)) {
    style.background = value;
    style.backgroundClip = 'text';
    style.webkitBackgroundClip = 'text';
    style.webkitTextFillColor = 'transparent';
  } else {
    style.color = value;
  }
}

// Restyle a row's sample text and "theme" label from its controls.
function refreshRow(row) {
  const family = state.fonts.find((f) => f.key === row.font.value);
  const sample = row.sample;
  ensureFontLoaded(family);
  sample.style.fontFamily = family ? family.stack : '';
  sample.style.fontSize = row.isSizeSet ? `${row.size.value}em` : '';
  row.sizeValue.textContent = row.isSizeSet ? `${row.size.value}em` : t('theme');
  applyTextColor(sample, row.colorValue);
  row.colorSwatch.style.background = row.colorValue || '';
  row.colorState.textContent = row.colorValue ? '' : t('theme');
  sample.style.fontWeight = row.weight.value || '';
  sample.style.fontStyle = row.fontStyle.value || '';
  sample.style.textTransform = row.textTransform.value || '';
}

const NO_BACKGROUND_COLOR = '#ffffff'; // shown when the user opens the picker with no background set yet
const NEUTRAL_SAMPLE_BACKGROUND = '#7a7f87';
const DEFAULT_TEXT_COLOR = '#ffffff'; // a row's picker starts here until a colour is chosen

// Show the chosen slide background in the swatch and behind every sample; with none set, a neutral grey
// that keeps both light and dark sample text readable.
function refreshBackground() {
  const bg = state.background;
  if (!bg) return;
  const value = bg.isSet ? bg.picker.getValue() : '';
  bg.swatch.style.background = value;
  bg.stateLabel.textContent = bg.isSet ? '' : t('theme');
  const sampleBackground = value || NEUTRAL_SAMPLE_BACKGROUND;
  bg.cells.forEach((cell) => { cell.style.background = sampleBackground; });
}

function setBackground(value) {
  const bg = state.background;
  bg.isSet = !!value;
  bg.picker.setValue(value || NO_BACKGROUND_COLOR);
  refreshBackground();
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
  row.colorValue = cleanTextColor(values.color, row.allowGradient);
  if (row.colorPicker) row.colorPicker.setValue(row.colorValue || DEFAULT_TEXT_COLOR);
  row.weight.value = values.fontWeight || '';
  row.fontStyle.value = values.fontStyle || '';
  row.textTransform.value = values.textTransform || '';
  refreshRow(row);
}

// The hidden table row under an element row that holds its colour picker (mounted on first open).
function buildColorPanel(row) {
  row.colorPanel = document.createElement('tr');
  row.colorPanel.className = 'style-color-panel';
  row.colorPanel.hidden = true;
  const cell = document.createElement('td');
  cell.colSpan = 8;
  if (row.allowGradient) {
    const hint = document.createElement('p');
    hint.className = 'style-color-hint';
    hint.textContent = t('Gradient text spreads across the whole width of the text block, so vertical gradients (to bottom) look best.');
    cell.appendChild(hint);
  }
  row.colorHost = document.createElement('div');
  cell.appendChild(row.colorHost);
  row.colorPanel.appendChild(cell);
}

function toggleColorPanel(row) {
  row.colorPanel.hidden = !row.colorPanel.hidden;
  if (row.colorPanel.hidden || row.colorPicker) return;
  row.colorPicker = mountGradientPicker(row.colorHost, {
    value: row.colorValue || DEFAULT_TEXT_COLOR,
    alpha: true,
    gradient: row.allowGradient,
    translate: t,
    onChange: (value) => {
      row.colorValue = cleanTextColor(value, row.allowGradient);
      onEdit(row);
    }
  });
}

// Build the panel into `container`. Call once (and await it) before loadStyleTab().
export async function buildStyleTab(container) {
  await loadBundledFonts();
  const layout = cloneTemplate('tpl-style-layout');
  const body = layout.querySelector('[data-role="rows"]');

  for (const el of STYLE_ELEMENTS) {
    const tr = cloneTemplate('tpl-style-row');
    const row = {
      sample: tr.querySelector('[data-role="sample"]'),
      font: tr.querySelector('[data-role="font"]'),
      size: tr.querySelector('[data-role="size"]'),
      sizeValue: tr.querySelector('[data-role="size-value"]'),
      colorSwatch: tr.querySelector('[data-role="color-swatch"]'),
      colorState: tr.querySelector('[data-role="color-state"]'),
      colorPanel: null,
      colorHost: null,
      colorPicker: null,
      colorValue: '',
      allowGradient: !!el.gradientText,
      weight: tr.querySelector('[data-role="weight"]'),
      fontStyle: tr.querySelector('[data-role="font-style"]'),
      textTransform: tr.querySelector('[data-role="text-transform"]'),
      isSizeSet: false
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
    fillSelect(row.fontStyle, [{ options: FONT_STYLES }]);
    fillSelect(row.textTransform, [{ options: TEXT_TRANSFORMS, translate: false }]);

    row.font.addEventListener('change', () => onEdit(row));
    row.weight.addEventListener('change', () => onEdit(row));
    row.fontStyle.addEventListener('change', () => onEdit(row));
    row.textTransform.addEventListener('change', () => onEdit(row));
    row.size.addEventListener('input', () => { row.isSizeSet = true; onEdit(row); });
    row.colorSwatch.addEventListener('click', () => toggleColorPanel(row));
    tr.querySelector('[data-role="reset"]').addEventListener('click', () => {
      setRowValues(row);
      onEdit(row);
    });

    state.rows.set(el.key, row);
    buildColorPanel(row);
    refreshRow(row);
    body.appendChild(tr);
    body.appendChild(row.colorPanel);
  }

  layout.querySelector('[data-role="reset-all"]').addEventListener('click', () => {
    for (const row of state.rows.values()) setRowValues(row);
    setBackground('');
    state.touched = true;
    markDirty();
  });

  const bgHost = layout.querySelector('[data-role="bg-picker"]');
  state.background = {
    picker: null,
    swatch: layout.querySelector('[data-role="bg-swatch"]'),
    stateLabel: layout.querySelector('[data-role="bg-state"]'),
    isSet: false,
    cells: body.querySelectorAll('.style-sample-cell')
  };
  state.background.picker = mountGradientPicker(bgHost, {
    value: NO_BACKGROUND_COLOR,
    alpha: false,
    translate: t,
    onChange: () => {
      state.background.isSet = true;
      state.touched = true;
      refreshBackground();
      markDirty();
    }
  });
  layout.querySelector('[data-role="bg-toggle"]').addEventListener('click', () => { bgHost.hidden = !bgHost.hidden; });
  layout.querySelector('[data-role="bg-reset"]').addEventListener('click', () => {
    setBackground('');
    state.touched = true;
    markDirty();
  });
  refreshBackground();

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
    setBackground(parsed.background || '');
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
