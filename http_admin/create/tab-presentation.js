/*
 * Presentation and Theme tabs of the Create / Edit Metadata form: slug field, title-slide option, theme picker.
 *
 * - injectSlugField(): adds the Slug input under the title. In create mode the slug follows the
 *   title (slugified + a random four-digit suffix) until the user edits it; in edit mode it is
 *   read-only. The input is shared through formState.slugInput (submitForm and the edit-mode
 *   loader use it).
 * - createThemePicker() and friends: card grid of installed themes (electronAPI.getAvailableThemes,
 *   thumbnails from /css/theme-thumbnails). Registered with core as the 'theme' builder, so
 *   createField() renders it for the `theme` select; 'syncThemePickerInput' lets setValues()
 *   refresh it after loading existing metadata.
 * - buildTitleSlideOption(): the create-mode-only "Create a Title Slide" checkbox.
 *
 * Fixed markup (slug field, title-slide option, theme picker chrome, theme card) comes from the
 * tpl-slug-field / tpl-title-slide-option / tpl-theme-* templates in create/templates.html via
 * cloneTemplate(); this file fills in values and wires behavior.
 *
 * Callers: create.js (injectSlugField, buildTitleSlideOption) and core via the registry.
 * Gotchas: injectSlugField must run after the Presentation fields are built.
 */
import { formState, lang, t, tf, slugify, randomFourDigits, registerFieldBuilder, cloneTemplate } from './metadata-form-core.js';

const SLUG_FIELD_NAME = '__slug';
let slugManuallyEdited = false;
let slugSuffix = randomFourDigits();
let titleInput = null;

// In create mode, the "Create a Title Slide" checkbox at the end of the Presentation tab.
export function buildTitleSlideOption(tabContainer) {
  const titleSlideContainer = cloneTemplate('tpl-title-slide-option');
  tabContainer.appendChild(titleSlideContainer);
}

// Slug suggestion: slugified title plus the per-session random suffix ("presentation" if empty).
function buildAutoSlugFromTitle(title) {
  const base = slugify(title) || 'presentation';
  return `${base}-${slugSuffix}`;
}

// Insert the Slug input after the title field; it auto-follows the title. Not shown at all in edit mode (the slug can't change).
export function injectSlugField() {
  if (window.editMode) return;
  titleInput = formState.form.querySelector('input[name="title"]');
  if (!titleInput) return;

  const titleWrapper = titleInput.closest('div');
  if (!titleWrapper) return;

  const wrapper = cloneTemplate('tpl-slug-field');
  const input = wrapper.querySelector('#slug-input');
  input.name = SLUG_FIELD_NAME;

  titleWrapper.insertAdjacentElement('afterend', wrapper);
  formState.slugInput = input;

  formState.slugInput.value = buildAutoSlugFromTitle(titleInput.value);

  titleInput.addEventListener('input', () => {
    if (slugManuallyEdited) return;
    formState.slugInput.value = buildAutoSlugFromTitle(titleInput.value);
  });

  formState.slugInput.addEventListener('input', () => {
    slugManuallyEdited = true;
  });
}

// Build the theme picker (current-theme summary plus an always-visible card grid) for the `theme` select (registered as the "theme" builder).
function createThemePicker(key, def, appDefault) {
  const wrapper = cloneTemplate('tpl-theme-picker');
  if (def.advanced) {
    wrapper.classList.add('advanced');
  }

  const label = wrapper.querySelector('[data-role="label"]');
  label.textContent = (def.label && def.label[lang]) ? def.label[lang] : key;
  if (def.doc && def.doc[lang]) label.title = def.doc[lang];

  const input = wrapper.querySelector('[data-role="input"]');
  input.name = key;
  input.value = appDefault || '';

  const grid = wrapper.querySelector('[data-role="grid"]');
  grid.setAttribute('aria-label', label.textContent);

  populateThemePicker(grid, input, appDefault);
  return wrapper;
}

// Build one theme card (thumbnail with placeholder fallback, title, filename) that calls onSelect on click.
function buildThemeCard(theme, index, onSelect) {
  const themeBase = theme.replace(/\.css$/i, '');
  const themeLabel = themeBase
    .split(/[-_]+/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  const card = cloneTemplate('tpl-theme-card');
  card.dataset.themeValue = theme;
  card.style.setProperty('--theme-card-delay', `${index * 30}ms`);

  const preview = card.querySelector('.theme-card-preview');
  const img = card.querySelector('[data-role="img"]');
  img.alt = tf('{theme} preview', { theme: themeLabel });
  img.src = `/css/theme-thumbnails/${themeBase}.jpg`;
  img.onerror = () => {
    img.remove();
    preview.classList.add('theme-card-preview--missing');
    preview.appendChild(cloneTemplate('tpl-theme-card-placeholder'));
  };

  card.querySelector('[data-role="title"]').textContent = themeLabel;
  card.querySelector('[data-role="meta"]').textContent = theme;

  card.addEventListener('click', () => onSelect(theme));
  return card;
}

// Fill the grid with cards for the installed themes and select the current/default one.
async function populateThemePicker(grid, input, appDefault) {
  let themes = await window.electronAPI.getAvailableThemes();
  const selected = input.value || appDefault || '';

  if (selected && !themes.includes(selected)) {
    themes = [selected, ...themes];
  }

  grid.innerHTML = '';
  themes.forEach((theme, index) => {
    const card = buildThemeCard(theme, index, (value) => {
      setThemePickerValue(grid, input, value, true);
    });
    if (theme === selected && !grid.dataset.selected) {
      card.classList.add('is-selected');
      card.setAttribute('aria-selected', 'true');
      grid.dataset.selected = theme;
    }
    grid.appendChild(card);
  });

  if (!grid.dataset.selected && themes.length) {
    setThemePickerValue(grid, input, selected || themes[0], false);
  }
  updateThemePickerSummary(input);
}

// Select a theme: update the input, card highlighting and summary; optionally fire a change event.
function setThemePickerValue(grid, input, value, emitChange) {
  if (!value) return;
  input.value = value;
  grid.dataset.selected = value;
  Array.from(grid.querySelectorAll('.theme-card')).forEach(card => {
    const isSelected = card.dataset.themeValue === value;
    card.classList.toggle('is-selected', isSelected);
    card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  });
  if (emitChange) {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  updateThemePickerSummary(input);
}

// Refresh the picker UI from the input's value (registered for setValues() after loading metadata).
function syncThemePickerInput(input) {
  const wrapper = input.closest('.theme-picker');
  if (!wrapper) return;
  const grid = wrapper.querySelector('.theme-picker-grid');
  if (!grid) return;
  setThemePickerValue(grid, input, input.value, false);
}

// Update the "current theme" summary (title, filename, thumbnail) from the input value.
function updateThemePickerSummary(input) {
  const wrapper = input.closest('.theme-picker');
  if (!wrapper) return;
  const summaryTitle = wrapper.querySelector('.theme-summary-title');
  const summaryMeta = wrapper.querySelector('.theme-summary-meta');
  const summaryImg = wrapper.querySelector('.theme-summary-preview img');
  if (!summaryTitle || !summaryMeta || !summaryImg) return;

  const theme = input.value || '';
  const themeBase = theme.replace(/\.css$/i, '');
  const themeLabel = themeBase
    .split(/[-_]+/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  summaryTitle.textContent = themeLabel || t('No theme selected');
  summaryMeta.textContent = theme || '—';
  summaryImg.src = theme ? `/css/theme-thumbnails/${themeBase}.jpg` : '';
  summaryImg.onerror = () => {
    summaryImg.removeAttribute('src');
  };
  renderThemeSamples(wrapper.querySelector('[data-role="samples"]'), summaryImg, themeBase, theme ? themeLabel : '');
}

// Sample slides generated per theme (Debug -> Generate Theme Thumbnails): <theme>.jpg is slide 1, then
// <theme>.2.jpg ... <theme>.N.jpg. Shows a clickable 2x2 grid on the right of the summary; clicking one swaps the large preview and expands the bar.
// Images that don't exist (older thumbnail sets) just remove themselves, so the grid just has fewer thumbnails.
const THEME_SAMPLE_COUNT = 4;

// Clicking a sample enlarges the top bar (.is-expanded); a click anywhere outside the sample grid shrinks it again.
document.addEventListener('click', (e) => {
  document.querySelectorAll('.theme-picker-current.is-expanded').forEach((panel) => {
    if (!e.target.closest?.('.theme-summary-samples')) panel.classList.remove('is-expanded');
  });
});
function renderThemeSamples(strip, summaryImg, themeBase, themeLabel) {
  if (!strip) return;
  strip.replaceChildren();
  if (!themeBase) return;
  for (let n = 1; n <= THEME_SAMPLE_COUNT; n++) {
    const src = `/css/theme-thumbnails/${themeBase}${n === 1 ? '' : `.${n}`}.jpg`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-sample';
    btn.setAttribute('aria-label', tf('{theme} sample slide {n}', { theme: themeLabel, n }));
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = src;
    img.onerror = () => btn.remove();
    btn.appendChild(img);
    btn.addEventListener('click', () => {
      strip.closest('.theme-picker-current')?.classList.add('is-expanded');
      summaryImg.src = src;
      strip.querySelectorAll('.theme-sample').forEach(b => b.classList.toggle('is-active', b === btn));
    });
    if (n === 1) btn.classList.add('is-active');
    strip.appendChild(btn);
  }
}

registerFieldBuilder('theme', createThemePicker);
registerFieldBuilder('syncThemePickerInput', syncThemePickerInput);
