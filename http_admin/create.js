import { AUTO_ANIMATE_EASINGS, resolveEasing, findEasingByCss } from '/js/easings.js';

let schema = {};
let mediaUsageCounts = {}; // Track how many times each media alias is referenced
let formDirty = false;
let presentation_dir = '';
let slug_editMode = '';
let mdFile_editMode = '';

await fetch('./presentation-schema.json')
  .then(res => res.json())
  .then(data => {
    schema = data;
  });

let lang = navigator.language || navigator.userLanguage || 'en';
lang = lang.split('-')[0];

const form = document.getElementById('create-form');

const ASPECT_STOPS = [
  { label: '9:16', ratio: 9 / 16 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '21:9', ratio: 21 / 9 }
];
const ZOOM_MIN_HEIGHT = 360;   // zoomed in
const ZOOM_MAX_HEIGHT = 2160;  // zoomed out
const ZOOM_SLIDER_STEPS = 1000;
const ZOOM_BASE_HEIGHT = 1080; // the 1.0x zoom
const ZOOM_SNAP_FACTORS = [0.5, 2 / 3, 0.75, 1, 1.25, 4 / 3, 1.5, 5 / 3, 2, 2.5, 3];
const ZOOM_SNAP_TOLERANCE = 0.05;
const PREVIEW_BASE_FONT_PX = 40;
const MIN_MAX_SCALE = 4;
const UHD_SCREEN_HEIGHT = 2160; // content must be able to scale up to a 4K screen
// ...and down into a window this small without spilling off the page
const SMALL_WINDOW_WIDTH = 160;
const SMALL_WINDOW_HEIGHT = 120;
const MAX_MIN_SCALE = 0.2; // reveal.js default; never ask for a larger floor

const AUTO_MODE_DEFAULT_SECONDS = 10;
let setupControls = null;

// Setup-tab dropdowns mirrored from select fields in the Advanced tab
const SETUP_SELECTS = [
  { name: 'config.transition', label: 'Slide Transition', field: 'transition' },
  { name: 'config.transitionSpeed', label: 'Transition Speed', field: 'transitionSpeed' }
];

// Define which fields go in which tabs
const tabFields = {
  presentation: ['title', 'slug', 'description', 'author', 'theme'],
  advanced: ['stylesheet', 'thumbnail', 'created', 'newSlideOnHeading', 'scrollspeed', 'config', 'confidence'],
  media: ['media'],
  macros: ['macros'],
  imports: ['imports']
};

// Build form with tabs
buildFormWithTabs(schema, tabFields);

// Set up tab switching
setupTabSwitching();

const SLUG_FIELD_NAME = '__slug';
let slugManuallyEdited = false;
let slugSuffix = randomFourDigits();
let titleInput = null;
let slugInput = null;

injectSlugField();

// Add submit button to form-buttons container
const submitBtn = document.createElement('button');
submitBtn.type = 'submit';
submitBtn.className = 'submit-button';
submitBtn.setAttribute('data-translate','true');
if(window.editMode) {
  submitBtn.textContent = 'Save Metadata';
} else {
  submitBtn.textContent = 'Create Presentation';
}
const buttonContainer = form.querySelector('.form-buttons');
if (buttonContainer) {
  buttonContainer.appendChild(submitBtn);
}

form.addEventListener('submit', submitForm); 


const createTitle = document.getElementById('create-title-slide');
const metadataHelpBtn = document.getElementById('metadata-help-btn');

if (metadataHelpBtn) {
  metadataHelpBtn.addEventListener('click', () => {
    if (!window.electronAPI?.openHandoutView) {
      window.alert('Help is only available in the desktop app.');
      return;
    }
    window.electronAPI.openHandoutView('readme', 'revelation-doc-metadata_reference.md').catch((err) => {
      console.error(err);
      window.alert(`Failed to open help: ${err.message || err}`);
    });
  });
}

if(window.editMode) {
  const urlParams = new URLSearchParams(window.location.search);
  slug_editMode = urlParams.get('slug');
  mdFile_editMode = urlParams.get('md');
  presentation_dir = urlParams.get('dir');
  const fullPath = `/${presentation_dir}/${slug_editMode}/${mdFile_editMode}`;

  if(slug_editMode && mdFile_editMode && presentation_dir) {
    document.getElementById('presentation-file-path').textContent = `${slug_editMode}/${mdFile_editMode}`;
    form.setAttribute('data-slug', slug_editMode);
    form.setAttribute('data-mdfile', mdFile_editMode);
    if (slugInput) {
      slugInput.value = slug_editMode;
    }
  } else {
    document.getElementById('presentation-file-path').textContent = 'No slug or mdFile specified';
  }

  // Show back button in edit mode
  const backBtn = document.getElementById('back-to-builder-btn');
  if (backBtn) {
    backBtn.style.display = 'block';
    backBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (formDirty) {
        if (confirm('You have unsaved changes. Discard them and go back to the presentation?')) {
          const params = new URLSearchParams({
            dir: presentation_dir,
            slug: slug_editMode,
            md: mdFile_editMode
          });
          window.location.href = `/admin/builder.html?${params.toString()}`;
        }
      } else {
        const params = new URLSearchParams({
          dir: presentation_dir,
          slug: slug_editMode,
          md: mdFile_editMode
        });
        window.location.href = `/admin/builder.html?${params.toString()}`;
      }
    });
  }

  fetch(fullPath)
    .then(res => res.text())
    .then(md => {
      const match = md.match(/^---\n([\s\S]*?)\n---/);
      if (match) {
        const yamlText = match[1];
        const metadata = jsyaml.load(yamlText);

        // Count media usage BEFORE rendering tiles
        if (metadata.media) {
          mediaUsageCounts = countMediaUsage(md, Object.keys(metadata.media));
        }

        setValues(metadata, '');
        syncSetupFromInputs();

        // Populate macros
        if (metadata.macros) {
          const macrosJson = document.getElementById('macros-json');
          if (macrosJson) {
            macrosJson.value = JSON.stringify(metadata.macros, null, 2);
            renderMacroTiles();
          }
        }

        // Populate imports file
        if (metadata.imports) {
          const importsInput = document.getElementById('imports-input');
          if (importsInput) {
            importsInput.value = metadata.imports;
            // Trigger UI update to show Edit/Clear buttons
            importsInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }

        // Reset dirty flag after loading initial values
        formDirty = false;
      }
    })
    .catch(err => console.error("Failed to load metadata", err));

  // Track form changes
  form.addEventListener('input', () => {
    formDirty = true;
  }, true);
  form.addEventListener('change', () => {
    formDirty = true;
  }, true);

}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function randomFourDigits() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

function countMediaUsage(markdown, mediaAliases) {
  // Extract content after the YAML frontmatter
  const match = markdown.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  const content = match ? match[1] : '';

  const counts = {};
  for (const alias of mediaAliases) {
    // Count occurrences of "media:alias" (case-insensitive to be safe)
    const pattern = new RegExp(`media:\\s*${alias}`, 'gi');
    const matches = content.match(pattern);
    counts[alias] = matches ? matches.length : 0;
  }
  return counts;
}

function setupTabSwitching() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.getAttribute('data-tab');

      // Update button states
      tabButtons.forEach(btn => {
        btn.setAttribute('aria-selected', btn === button ? 'true' : 'false');
      });

      // Update content visibility
      tabContents.forEach(content => {
        if (content.id === `tab-${tabName}`) {
          content.removeAttribute('hidden');
        } else {
          content.setAttribute('hidden', '');
        }
      });
    });
  });
}

function buildFormWithTabs(schema, tabFields) {
  const tabs = {
    presentation: document.getElementById('tab-presentation'),
    setup: document.getElementById('tab-setup'),
    advanced: document.getElementById('tab-advanced'),
    media: document.getElementById('tab-media'),
    macros: document.getElementById('tab-macros'),
    imports: document.getElementById('tab-imports')
  };

  // In create mode, add "Create a Title Slide" checkbox to Presentation tab
  if (!window.editMode) {
    const titleSlideContainer = document.createElement('div');
    titleSlideContainer.className = 'header-checkbox';
    const titleSlideInput = document.createElement('input');
    titleSlideInput.type = 'checkbox';
    titleSlideInput.id = 'create-title-slide';
    titleSlideInput.checked = true;
    const titleSlideLabel = document.createElement('label');
    titleSlideLabel.htmlFor = 'create-title-slide';
    titleSlideLabel.textContent = 'Create a Title Slide';
    titleSlideLabel.setAttribute('data-translate', 'true');
    titleSlideContainer.appendChild(titleSlideInput);
    titleSlideContainer.appendChild(titleSlideLabel);
    tabs.presentation.appendChild(titleSlideContainer);
  }

  // Categorize schema fields into tabs
  for (const key in schema) {
    let foundTab = null;
    for (const [tab, fields] of Object.entries(tabFields)) {
      if (fields.includes(key)) {
        foundTab = tab;
        break;
      }
    }

    if (foundTab && tabs[foundTab]) {
      const field = schema[key];
      if (key === 'media') {
        tabs[foundTab].appendChild(createMedia(field));
      } else if (key === 'macros') {
        tabs[foundTab].appendChild(createMacros(field));
      } else if (key === 'imports') {
        tabs[foundTab].appendChild(createImports(field));
      } else if (field.type === 'object') {
        const subFields = buildForm(field.fields, key);
        tabs[foundTab].appendChild(document.createElement('hr'));
        tabs[foundTab].appendChild(subFields);
      } else if (field.type === 'array') {
        tabs[foundTab].appendChild(buildDynamicArrayField(null, key, field));
      } else {
        tabs[foundTab].appendChild(createField(key, field));
      }
    }
  }

  condenseIntoTable(tabs.advanced);
  buildSetupTab(tabs.setup);
}

// Collapse the label+input field wrappers in a tab into a two-column table.
// Anything else (dynamic array sections, etc.) is left in place after the table.
function condenseIntoTable(container) {
  const table = document.createElement('table');
  table.className = 'advanced-table';
  const body = document.createElement('tbody');
  table.appendChild(body);

  Array.from(container.children).forEach(child => {
    if (child.tagName === 'HR') {
      child.remove();
      return;
    }
    const label = child.querySelector(':scope > label');
    const input = child.querySelector(':scope > input, :scope > select, :scope > textarea');
    if (!label || !input) return;

    const row = document.createElement('tr');
    const th = document.createElement('th');
    const td = document.createElement('td');
    th.appendChild(label);
    td.appendChild(input);
    row.appendChild(th);
    row.appendChild(td);
    body.appendChild(row);
    child.remove();
  });

  container.insertBefore(table, container.firstChild);
}

// Zoom slider position (0 = zoomed out, ZOOM_SLIDER_STEPS = zoomed in) maps to
// height on a log scale, rounded to 10 below 1080 and to 20 from 1080 up.
function zoomPositionToHeight(pos) {
  const t = pos / ZOOM_SLIDER_STEPS;
  const raw = ZOOM_MAX_HEIGHT * Math.pow(ZOOM_MIN_HEIGHT / ZOOM_MAX_HEIGHT, t);

  // Snap to a "perfect" zoom (e.g. 1.5x = 720) when within 5% of it
  for (const factor of ZOOM_SNAP_FACTORS) {
    const perfect = Math.round(ZOOM_BASE_HEIGHT / factor);
    if (Math.abs(raw / perfect - 1) <= ZOOM_SNAP_TOLERANCE) {
      return Math.max(ZOOM_MIN_HEIGHT, Math.min(ZOOM_MAX_HEIGHT, perfect));
    }
  }

  const step = raw < 1080 ? 10 : 20;
  return Math.max(ZOOM_MIN_HEIGHT, Math.min(ZOOM_MAX_HEIGHT, Math.round(raw / step) * step));
}

function zoomHeightToPosition(height) {
  const h = Math.max(ZOOM_MIN_HEIGHT, Math.min(ZOOM_MAX_HEIGHT, height));
  return Math.round(ZOOM_SLIDER_STEPS * Math.log(h / ZOOM_MAX_HEIGHT) / Math.log(ZOOM_MIN_HEIGHT / ZOOM_MAX_HEIGHT));
}

// Convert between a (possibly fractional) slider position and an aspect ratio,
// interpolating in log space between neighbouring stops.
function aspectPositionToRatio(pos) {
  const i = Math.max(0, Math.min(ASPECT_STOPS.length - 2, Math.floor(pos)));
  const t = pos - i;
  const a = Math.log(ASPECT_STOPS[i].ratio);
  const b = Math.log(ASPECT_STOPS[i + 1].ratio);
  return Math.exp(a + (b - a) * t);
}

function aspectRatioToPosition(ratio) {
  const last = ASPECT_STOPS.length - 1;
  if (ratio <= ASPECT_STOPS[0].ratio) return 0;
  if (ratio >= ASPECT_STOPS[last].ratio) return last;
  for (let i = 0; i < last; i++) {
    const lo = ASPECT_STOPS[i].ratio;
    const hi = ASPECT_STOPS[i + 1].ratio;
    if (ratio >= lo && ratio <= hi) {
      return i + (Math.log(ratio) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
    }
  }
  return last;
}

// "Auto Mode" group: friendly controls over config.autoSlide (ms),
// config.loop and config.autoSlideStoppable (shows the advance indicator).
function buildAutoModeControls() {
  const autoSlideSrc = form.querySelector('[name="config.autoSlide"]');
  const loopSrc = form.querySelector('[name="config.loop"]');
  const indicatorSrc = form.querySelector('[name="config.autoSlideStoppable"]');
  if (!autoSlideSrc || !loopSrc || !indicatorSrc) return null;

  const group = document.createElement('div');
  group.className = 'setup-auto-tile';

  const makeCheckbox = (parent, id, text) => {
    const row = document.createElement('div');
    row.className = 'setup-check-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = text;
    label.setAttribute('data-translate', 'true');
    row.appendChild(input);
    row.appendChild(label);
    parent.appendChild(row);
    return { row, input };
  };

  const enable = makeCheckbox(group, 'setup-auto-enable', 'Advance Automatically');

  // Options only appear once Advance Automatically is checked
  const options = document.createElement('div');
  options.className = 'setup-auto-options';
  group.appendChild(options);

  const durationRow = document.createElement('div');
  durationRow.className = 'setup-duration-row';
  const durationLabel = document.createElement('label');
  durationLabel.htmlFor = 'setup-auto-seconds';
  durationLabel.textContent = 'Seconds per slide';
  durationLabel.setAttribute('data-translate', 'true');
  const seconds = document.createElement('input');
  seconds.type = 'number';
  seconds.id = 'setup-auto-seconds';
  seconds.min = '0.5';
  seconds.step = '0.5';
  seconds.value = String(AUTO_MODE_DEFAULT_SECONDS);
  durationRow.appendChild(durationLabel);
  durationRow.appendChild(seconds);
  options.appendChild(durationRow);

  const loop = makeCheckbox(options, 'setup-auto-loop', 'Loop back to the first slide');
  const indicator = makeCheckbox(options, 'setup-auto-indicator', 'Show slide advance indicator');

  const sync = () => {
    const ms = Number(autoSlideSrc.value) || 0;
    const on = ms > 0;
    enable.input.checked = on;
    if (on) seconds.value = String(ms / 1000);
    loop.input.checked = loopSrc.checked;
    indicator.input.checked = indicatorSrc.checked;
    options.hidden = !on;
  };

  const writeDuration = () => {
    const secs = Number(seconds.value);
    autoSlideSrc.value = String(Math.round((secs > 0 ? secs : AUTO_MODE_DEFAULT_SECONDS) * 1000));
  };

  enable.input.addEventListener('change', () => {
    if (enable.input.checked) {
      writeDuration();
    } else {
      autoSlideSrc.value = '0';
    }
    sync();
  });
  seconds.addEventListener('input', () => {
    if (enable.input.checked && Number(seconds.value) > 0) writeDuration();
  });
  loop.input.addEventListener('change', () => { loopSrc.checked = loop.input.checked; });
  indicator.input.addEventListener('change', () => { indicatorSrc.checked = indicator.input.checked; });

  // Changes made on the Advanced tab
  autoSlideSrc.addEventListener('input', sync);
  loopSrc.addEventListener('change', sync);
  indicatorSrc.addEventListener('change', sync);

  sync();
  return { group, sync };
}

// Imitates auto-animate: the badge on the visible sample slide moves and grows
// to its "matched" position on the next slide, using the configured easing and duration.
function playAutoAnimateDemo() {
  if (!setupControls) return;
  const state = setupControls;
  state.finishTransition?.();
  const badge = state.slides[state.currentStage].querySelector('.setup-preview-badge');
  if (!badge || !badge.animate) return;

  badge.getAnimations().forEach(a => a.cancel());
  const read = () => {
    const css = getComputedStyle(badge);
    return { left: css.left, bottom: css.bottom, width: css.width };
  };
  const before = read();
  badge.dataset.pos = badge.dataset.pos === 'b' ? 'a' : 'b';
  const after = read();

  const easing = resolveEasing(form.querySelector('[name="config.autoAnimateEasing"]')?.value.trim() || 'ease');
  const seconds = Number(form.querySelector('[name="config.autoAnimateDuration"]')?.value);
  const options = { duration: (seconds > 0 ? seconds : 1) * 1000, easing };
  try {
    badge.animate([before, after], options);
  } catch (err) {
    // Invalid custom easing: show the move with the default curve
    badge.animate([before, after], { ...options, easing: 'ease' });
  }
}

// Dropdown over the free-form config.autoAnimateEasing text field, which stores a
// preset name (see /js/easings.js). A value that isn't a preset (typed on the Advanced tab) shows as a "Custom" entry.
function buildEasingSelect(controls, selectMirrors) {
  const def = schema.config?.fields?.autoAnimateEasing;
  const source = form.querySelector('[name="config.autoAnimateEasing"]');
  if (!def || !source) return;

  const row = document.createElement('div');
  row.className = 'setup-select-row setup-easing-row';
  const group = document.createElement('div');
  group.className = 'setup-select-group';
  const label = document.createElement('label');
  label.htmlFor = 'setup-autoAnimateEasing';
  label.textContent = 'Auto-Animate Easing';
  label.setAttribute('data-translate', 'true');
  if (def.doc?.[lang]) label.title = def.doc[lang];

  const select = document.createElement('select');
  select.id = 'setup-autoAnimateEasing';
  AUTO_ANIMATE_EASINGS.forEach(({ name, label: text }) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = text;
    select.appendChild(option);
  });
  const custom = document.createElement('option');
  custom.hidden = true;
  select.appendChild(custom);

  const sync = () => {
    const value = (source.value || '').trim() || def.default;
    const preset = AUTO_ANIMATE_EASINGS.find(e => e.name === value.toLowerCase()) || findEasingByCss(value);
    if (preset) {
      custom.hidden = true;
      select.value = preset.name;
    } else {
      custom.value = value;
      custom.textContent = `Custom: ${value}`;
      custom.hidden = false;
      select.value = value;
    }
  };

  select.addEventListener('change', () => { source.value = select.value; playAutoAnimateDemo(); });
  source.addEventListener('input', sync);
  source.addEventListener('change', sync);

  group.appendChild(label);
  group.appendChild(select);
  row.appendChild(group);

  const animateBtn = document.createElement('button');
  animateBtn.type = 'button';
  animateBtn.className = 'setup-transition-btn';
  animateBtn.textContent = '▶ Preview Animation';
  animateBtn.setAttribute('data-translate', 'true');
  animateBtn.addEventListener('click', playAutoAnimateDemo);
  row.appendChild(animateBtn);

  controls.appendChild(row);
  selectMirrors.push({ select, source, sync });
  sync();
}

function buildSetupTab(container) {
  const wrapper = document.createElement('div');
  wrapper.className = 'setup-layout';

  const controls = document.createElement('div');
  controls.className = 'setup-controls';

  // Aspect ratio slider
  const aspectGroup = document.createElement('div');
  aspectGroup.className = 'setup-slider-group';
  const aspectHeader = document.createElement('div');
  aspectHeader.className = 'setup-slider-header';
  const aspectLabel = document.createElement('label');
  aspectLabel.htmlFor = 'setup-aspect';
  aspectLabel.textContent = 'Aspect Ratio';
  aspectLabel.setAttribute('data-translate', 'true');
  const aspectValue = document.createElement('span');
  aspectValue.className = 'setup-slider-value';
  aspectHeader.appendChild(aspectLabel);
  aspectHeader.appendChild(aspectValue);

  const aspectInput = document.createElement('input');
  aspectInput.type = 'range';
  aspectInput.id = 'setup-aspect';
  aspectInput.min = '0';
  aspectInput.max = String(ASPECT_STOPS.length - 1);
  aspectInput.step = '0.01';
  aspectInput.setAttribute('list', 'setup-aspect-stops');

  const aspectStops = document.createElement('datalist');
  aspectStops.id = 'setup-aspect-stops';
  ASPECT_STOPS.forEach((_, i) => {
    const option = document.createElement('option');
    option.value = String(i);
    aspectStops.appendChild(option);
  });

  const aspectTicks = document.createElement('div');
  aspectTicks.className = 'setup-aspect-ticks';
  ASPECT_STOPS.forEach(stop => {
    const tick = document.createElement('span');
    tick.textContent = stop.label;
    aspectTicks.appendChild(tick);
  });

  const aspectEnds = document.createElement('div');
  aspectEnds.className = 'setup-slider-ends';
  const portrait = document.createElement('span');
  portrait.textContent = 'Portrait';
  portrait.setAttribute('data-translate', 'true');
  const landscape = document.createElement('span');
  landscape.textContent = 'Landscape';
  landscape.setAttribute('data-translate', 'true');
  aspectEnds.appendChild(portrait);
  aspectEnds.appendChild(landscape);

  aspectGroup.appendChild(aspectHeader);
  aspectGroup.appendChild(aspectInput);
  aspectGroup.appendChild(aspectStops);
  aspectGroup.appendChild(aspectTicks);
  aspectGroup.appendChild(aspectEnds);

  // Zoom slider. Slider value runs zoomed out (left) -> zoomed in (right),
  // so it is the inverse of the height it controls.
  const zoomGroup = document.createElement('div');
  zoomGroup.className = 'setup-slider-group';
  const zoomHeader = document.createElement('div');
  zoomHeader.className = 'setup-slider-header';
  const zoomLabel = document.createElement('label');
  zoomLabel.htmlFor = 'setup-zoom';
  zoomLabel.textContent = 'Zoom';
  zoomLabel.setAttribute('data-translate', 'true');
  const zoomValue = document.createElement('span');
  zoomValue.className = 'setup-slider-value';
  zoomHeader.appendChild(zoomLabel);
  zoomHeader.appendChild(zoomValue);

  const zoomInput = document.createElement('input');
  zoomInput.type = 'range';
  zoomInput.id = 'setup-zoom';
  zoomInput.min = '0';
  zoomInput.max = String(ZOOM_SLIDER_STEPS);
  zoomInput.step = '1';

  const zoomEnds = document.createElement('div');
  zoomEnds.className = 'setup-slider-ends';
  const zoomedOut = document.createElement('span');
  zoomedOut.textContent = 'Zoomed Out';
  zoomedOut.setAttribute('data-translate', 'true');
  const zoomedIn = document.createElement('span');
  zoomedIn.textContent = 'Zoomed In';
  zoomedIn.setAttribute('data-translate', 'true');
  zoomEnds.appendChild(zoomedOut);
  zoomEnds.appendChild(zoomedIn);

  zoomGroup.appendChild(zoomHeader);
  zoomGroup.appendChild(zoomInput);
  zoomGroup.appendChild(zoomEnds);

  controls.appendChild(aspectGroup);
  controls.appendChild(zoomGroup);

  const autoMode = buildAutoModeControls();

  const selectMirrors = [];
  const selectRow = document.createElement('div');
  selectRow.className = 'setup-select-row';
  controls.appendChild(selectRow);
  SETUP_SELECTS.forEach(({ name, label, field }) => {
    const def = schema.config?.fields?.[field];
    const source = form.querySelector(`[name="${name}"]`);
    if (!def || !source) return;

    const group = document.createElement('div');
    group.className = 'setup-select-group';
    const selectLabel = document.createElement('label');
    selectLabel.htmlFor = `setup-${field}`;
    selectLabel.textContent = label;
    selectLabel.setAttribute('data-translate', 'true');
    if (def.doc?.[lang]) selectLabel.title = def.doc[lang];

    const select = document.createElement('select');
    select.id = `setup-${field}`;
    def.options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = String(opt).charAt(0).toUpperCase() + String(opt).slice(1);
      select.appendChild(option);
    });
    select.value = source.value;

    select.addEventListener('change', () => { source.value = select.value; playTransitionDemo(); });
    source.addEventListener('change', () => { select.value = source.value; playTransitionDemo(); });

    group.appendChild(selectLabel);
    group.appendChild(select);
    selectRow.appendChild(group);
    selectMirrors.push({ select, source });
  });

  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.className = 'setup-transition-btn';
  previewBtn.textContent = '▶ Preview Transition';
  previewBtn.setAttribute('data-translate', 'true');
  previewBtn.addEventListener('click', playTransitionDemo);
  selectRow.appendChild(previewBtn);

  buildEasingSelect(controls, selectMirrors);

  // Preview
  const previewWrap = document.createElement('div');
  previewWrap.className = 'setup-preview-wrap';
  const frame = document.createElement('div');
  frame.className = 'setup-preview-frame';

  // Two sample slides; each preview transition moves forward to the other one
  const makeSampleStage = (extraClass, title, text) => {
    const stage = document.createElement('div');
    stage.className = `setup-preview-stage ${extraClass}`;
    const slide = document.createElement('div');
    slide.className = 'setup-preview-slide';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const body = document.createElement('p');
    body.textContent = text;
    slide.appendChild(heading);
    slide.appendChild(body);
    const badge = document.createElement('div');
    badge.className = 'setup-preview-badge';
    slide.appendChild(badge);
    stage.appendChild(slide);
    frame.appendChild(stage);
    return { stage, slide };
  };
  const first = makeSampleStage('', 'Sample Slide', 'This preview shows how text wraps at the selected aspect ratio and zoom level. Zoom in for larger text and fewer words per line.');
  const second = makeSampleStage('setup-preview-stage-alt setup-preview-stage-hidden', 'Another Sample', 'Text wraps the same way here. Try a different zoom or aspect ratio to see how much fits on each line.');
  const stages = [first.stage, second.stage];
  const slides = [first.slide, second.slide];
  const dims = document.createElement('div');
  dims.className = 'setup-preview-dims';
  previewWrap.appendChild(frame);
  previewWrap.appendChild(dims);
  if (autoMode) previewWrap.appendChild(autoMode.group);

  wrapper.appendChild(controls);
  wrapper.appendChild(previewWrap);
  container.appendChild(wrapper);

  setupControls = { autoMode, selectMirrors, aspectInput, zoomInput, aspectValue, zoomValue, frame, stages, slides, currentStage: 0, finishTransition: null, dims };

  const getDimensionInputs = () => ({
    widthInput: form.querySelector('[name="config.width"]'),
    heightInput: form.querySelector('[name="config.height"]')
  });

  // Slider -> width/height inputs
  const applySlidersToInputs = () => {
    const { widthInput, heightInput } = getDimensionInputs();
    const height = zoomPositionToHeight(Number(zoomInput.value));
    const ratio = aspectPositionToRatio(Number(aspectInput.value));
    if (heightInput) heightInput.value = String(height);
    if (widthInput) widthInput.value = String(Math.round(height * ratio));
    updateScaleLimits(Math.round(height * ratio), height);
    renderSetupPreview(Math.round(height * ratio), height, ratio);
  };

  aspectInput.addEventListener('input', () => {
    // Snap to the nearest named stop
    aspectInput.value = String(Math.round(Number(aspectInput.value)));
    applySlidersToInputs();
  });
  zoomInput.addEventListener('input', applySlidersToInputs);

  // width/height inputs (Advanced tab or loaded values) -> sliders
  const { widthInput, heightInput } = getDimensionInputs();
  [widthInput, heightInput].forEach(input => {
    if (input) input.addEventListener('input', syncSetupFromInputs);
  });
  [widthInput, heightInput].forEach(input => {
    if (input) {
      input.addEventListener('input', () => updateScaleLimits(Number(widthInput?.value), Number(heightInput?.value)));
    }
  });

  syncSetupFromInputs();
}

// Reveal.js transition speeds (ms) and the start state of an incoming slide.
// The outgoing slide mirrors it to the opposite side.
const TRANSITION_DURATIONS = { default: 800, fast: 400, slow: 1200 };
// Horizontal transforms copied from reveal.js (css/reveal.scss)
const TRANSITION_FUTURE = {
  fade: { opacity: 0 },
  slide: { opacity: 0, transform: 'translate(150%, 0)' },
  convex: { opacity: 0, transform: 'translate3d(100%, 0, 0) rotateY(90deg) translate3d(100%, 0, 0)' },
  concave: { opacity: 0, transform: 'translate3d(100%, 0, 0) rotateY(-90deg) translate3d(100%, 0, 0)' },
  zoom: { opacity: 0, transform: 'scale(0.2)' }
};
const TRANSITION_PAST = {
  fade: { opacity: 0 },
  slide: { opacity: 0, transform: 'translate(-150%, 0)' },
  convex: { opacity: 0, transform: 'translate3d(-100%, 0, 0) rotateY(-90deg) translate3d(-100%, 0, 0)' },
  concave: { opacity: 0, transform: 'translate3d(-100%, 0, 0) rotateY(90deg) translate3d(-100%, 0, 0)' },
  zoom: { opacity: 0, transform: 'scale(16)' }
};

// Lightweight CSS imitation of the selected reveal.js transition. The two sample
// slides alternate: the one showing leaves while the other arrives.
function playTransitionDemo() {
  if (!setupControls || !setupControls.frame.animate) return;
  const state = setupControls;
  state.finishTransition?.(); // settle any transition still in flight

  const type = form.querySelector('[name="config.transition"]')?.value;
  const speed = form.querySelector('[name="config.transitionSpeed"]')?.value;
  const future = TRANSITION_FUTURE[type];
  const past = TRANSITION_PAST[type];

  const outgoing = state.stages[state.currentStage];
  const incoming = state.stages[1 - state.currentStage];

  const finish = () => {
    outgoing.getAnimations().concat(incoming.getAnimations()).forEach(a => a.cancel());
    outgoing.classList.add('setup-preview-stage-hidden');
    outgoing.style.zIndex = '';
    incoming.style.zIndex = '';
    state.currentStage = 1 - state.currentStage;
    state.finishTransition = null;
  };

  incoming.classList.remove('setup-preview-stage-hidden');
  if (!future) { // "none" switches instantly
    finish();
    return;
  }

  outgoing.style.zIndex = '1';
  incoming.style.zIndex = '2';
  const timing = {
    duration: TRANSITION_DURATIONS[speed] || TRANSITION_DURATIONS.default,
    easing: 'ease',
    fill: 'both'
  };
  const identity = { opacity: 1, transform: 'none' };
  incoming.animate([{ transform: 'none', ...future }, identity], timing);
  const out = outgoing.animate([identity, { transform: 'none', ...past }], timing);
  state.finishTransition = finish;
  out.onfinish = () => {
    if (state.finishTransition === finish) finish();
  };
}

// Derive config.maxScale / config.minScale from the slide size.
// maxScale: ceil(4K height / slide height) + 1 for headroom, never below MIN_MAX_SCALE.
// minScale: the scale at which the slide still fits a SMALL_WINDOW_WIDTH x SMALL_WINDOW_HEIGHT
//   window, floored to 0.01 and capped at MAX_MIN_SCALE.
function updateScaleLimits(width, height) {
  if (!(height > 0)) return;
  const maxScaleInput = form.querySelector('[name="config.maxScale"]');
  if (maxScaleInput) {
    maxScaleInput.value = String(Math.max(MIN_MAX_SCALE, Math.ceil(UHD_SCREEN_HEIGHT / height) + 1));
  }

  const minScaleInput = form.querySelector('[name="config.minScale"]');
  if (minScaleInput && width > 0) {
    const fit = Math.min(SMALL_WINDOW_WIDTH / width, SMALL_WINDOW_HEIGHT / height);
    const floored = Math.floor(fit * 100 + 1e-9) / 100;
    minScaleInput.value = String(Math.max(0.01, Math.min(MAX_MIN_SCALE, floored)));
  }
}

function syncSetupFromInputs() {
  if (!setupControls) return;
  setupControls.selectMirrors.forEach(({ select, source, sync }) => {
    if (sync) sync();
    else select.value = source.value;
  });
  setupControls.autoMode?.sync();
  const widthInput = form.querySelector('[name="config.width"]');
  const heightInput = form.querySelector('[name="config.height"]');
  const width = Number(widthInput?.value);
  const height = Number(heightInput?.value);
  if (!(width > 0) || !(height > 0)) return;

  const ratio = width / height;
  setupControls.aspectInput.value = String(aspectRatioToPosition(ratio));
  setupControls.zoomInput.value = String(zoomHeightToPosition(height));
  renderSetupPreview(width, height, ratio);
}

function describeAspect(ratio) {
  const stop = ASPECT_STOPS.find(s => Math.abs(s.ratio - ratio) < 0.005);
  return stop ? stop.label : `${ratio.toFixed(2)}:1`;
}

function renderSetupPreview(width, height, ratio) {
  const { frame, slides, dims, aspectValue, zoomValue } = setupControls;
  aspectValue.textContent = describeAspect(ratio);
  zoomValue.textContent = `${(Math.round((ZOOM_BASE_HEIGHT / height) * 10) / 10).toFixed(1)}x`;
  dims.textContent = `${width} × ${height}`;

  // Fit the frame into the available preview box, then scale a real
  // width×height slide down into it so text wraps exactly as it would.
  const maxW = 380;
  const maxH = 300;
  const scale = Math.min(maxW / width, maxH / height);
  frame.style.width = `${width * scale}px`;
  frame.style.height = `${height * scale}px`;
  slides.forEach(slide => {
    slide.style.width = `${width}px`;
    slide.style.height = `${height}px`;
    slide.style.fontSize = `${PREVIEW_BASE_FONT_PX}px`;
    slide.style.transform = `scale(${scale})`;
  });
}

function buildAutoSlugFromTitle(title) {
  const base = slugify(title) || 'presentation';
  return `${base}-${slugSuffix}`;
}

function injectSlugField() {
  titleInput = form.querySelector('input[name="title"]');
  if (!titleInput) return;

  const titleWrapper = titleInput.closest('div');
  if (!titleWrapper) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'slug-field';
  const label = document.createElement('label');
  label.textContent = 'Slug';
  label.setAttribute('for', 'slug-input');

  const input = document.createElement('input');
  input.type = 'text';
  input.name = SLUG_FIELD_NAME;
  input.id = 'slug-input';
  input.placeholder = 'my-presentation-1234';

  const hint = document.createElement('div');
  hint.className = 'slug-help-text';
  hint.textContent = 'Folder/URL name. Lowercase letters, numbers, and dashes are best.';

  wrapper.appendChild(label);
  wrapper.appendChild(input);
  wrapper.appendChild(hint);
  titleWrapper.insertAdjacentElement('afterend', wrapper);
  slugInput = input;

  if (window.editMode) {
    slugInput.readOnly = true;
    slugInput.title = 'Slug cannot be changed here.';
    return;
  }

  slugInput.value = buildAutoSlugFromTitle(titleInput.value);

  titleInput.addEventListener('input', () => {
    if (slugManuallyEdited) return;
    slugInput.value = buildAutoSlugFromTitle(titleInput.value);
  });

  slugInput.addEventListener('input', () => {
    slugManuallyEdited = true;
  });
}

function setValues(metadata, prefix = '') {
  for (const key in metadata) {
    const value = metadata[key];

    if (prefix === '' && key === 'media') {
      const hidden = document.getElementById('media-json');
      hidden.value = JSON.stringify(value, null, 2);
      renderMediaTiles();
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively set values for nested objects
      setValues(value, prefix ? `${prefix}.${key}` : key);
    } else if (typeof value === 'object' && Array.isArray(value)) {
      // Handle macros later
    } else {
      const input = document.querySelector(`[name="${prefix ? `${prefix}.` : ''}${key}"]`);
      if (input) {
        if (input.type === 'checkbox') {
          input.checked = !!value;
        } else {
          input.value = value;
          if (input.dataset.themePicker === 'true') {
            syncThemePickerInput(input);
          }
        }
      }
    }
  }
}

function buildForm(schema, parentKey = '') {
  const fragment = document.createDocumentFragment();
  for (const key in schema) {
    const fullKey = parentKey ? `${parentKey}.${key}` : key;
    const field = schema[key];

    if (parentKey === '' && key === 'media') {
      // Needs special handling for media set
      fragment.appendChild(createMedia(field))
    } else if (field.type === 'object') {
      const subFields = buildForm(field.fields, fullKey);
      fragment.appendChild(document.createElement('hr'));
      fragment.appendChild(subFields);
    } else if (field.type === 'array') {
      fragment.appendChild(buildDynamicArrayField(fragment, fullKey, field));
    } else {
      fragment.appendChild(createField(fullKey, field));
    }
  }
  return fragment;
}

function buildDynamicArrayField(fragment, key, field) {

  const section = document.createElement('div');
  section.className = 'advanced';
  if (key === 'media' || key === 'macros') {
    section.className = ''; // Don't hide media/macros behind advanced checkbox
  }
  section.appendChild(document.createElement('hr'));

  const arrayLabel = document.createElement('label');
  arrayLabel.textContent = (field.label && field.label[lang]) ? field.label[lang] : key;
  section.appendChild(arrayLabel);

  const list = document.createElement('div');
  list.id = `${key}.list`;

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.textContent = `Add ${key}`;

  addButton.onclick = () => addDynamicItem(key, field);

  section.appendChild(list);
  section.appendChild(addButton);
  return section;
}

function addDynamicItem(fullKey, field) {
  const list = document.getElementById(`${fullKey}.list`);
  const wrapper = document.createElement('div');
  wrapper.className = `${fullKey}.listitem`;

  const nameInput = document.createElement('input');
  nameInput.name = `${fullKey}.name`;
  nameInput.placeholder = `${fullKey}.name`;
  nameInput.value = field.name || '';

  const valueInput = document.createElement('textarea');
  valueInput.name = `${fullKey}.value`;
  valueInput.placeholder = `${fullKey}.value`;
  valueInput.value = field.value || '';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Remove';
  removeBtn.onclick = () => wrapper.remove();

  wrapper.appendChild(nameInput);
  wrapper.appendChild(valueInput);
  wrapper.appendChild(removeBtn);
  list.appendChild(wrapper);
}

function createField(key, def) {
  const wrapper = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = (def.label && def.label[lang]) ? def.label[lang] : key;

  // Show doc as a tooltip on the label
  if (def.doc && def.doc[lang]) label.title = def.doc[lang];

  if (def.advanced) wrapper.className = 'advanced';

  let input;
  let appDefault = def.default;
  if( def.appDefault !== undefined) {
    appDefault = def.appDefault;
  }
  if (appDefault === 'today') {
    appDefault = new Date().toISOString().slice(0, 10); // Format as YYYY-MM-DD
  }
  if (def.type === 'select') {
    if (key === 'theme') {
      return createThemePicker(key, def, appDefault);
    }
    input = document.createElement('select');
    def.options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      if( opt === appDefault) {
        option.selected = true;
      }
      option.textContent = String(opt);
      input.appendChild(option);
    });
    input.value = appDefault;
  } else if (def.type === 'boolean') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = appDefault;
  } else if (def.type === 'textarea') {
    input = document.createElement('textarea');
    input.value = appDefault || '';
  } else {
    input = document.createElement('input');
    input.type = def.type === 'date' ? 'date' : 'text';
    input.value = appDefault;
  }

  input.name = key;

  // Optional: also set doc as a tooltip on the input itself
  if (def.doc) input.title = def.doc;

  wrapper.appendChild(label);
  wrapper.appendChild(input);
  return wrapper;
}

async function submitForm(e) {
  e.preventDefault();

  const result = document.getElementById('result');
  result.textContent = ''; // clear previous message

  try {
    const formData = new FormData(form);
    const userInput = Object.fromEntries(formData.entries());

    // Add missing checkbox values
    form.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      userInput[cb.name] = cb.checked;
    });

    // Filtered config object
    const filtered = getValidatedStructure(schema, userInput);

    const macrosRaw = userInput['macros'];
    if(macrosRaw) {
      const macrosParsed = JSON.parse(macrosRaw);
      filtered.macros = macrosParsed;
    }
    else {
      delete(filtered.macros);
    }

    const mediaRaw = userInput['media'];
    if(mediaRaw) {
      const mediaParsed = JSON.parse(mediaRaw);
      filtered.media = mediaParsed;
    }
    else {
      delete(filtered.media);
    }

    // Handle imports field
    const importsRaw = userInput['imports'];
    if(importsRaw && importsRaw.trim()) {
      filtered.imports = importsRaw.trim();
    }
    else {
      delete(filtered.imports);
    }

    let res;
    if (window.editMode) {
      const slug = form.getAttribute('data-slug');
      const mdFile = form.getAttribute('data-mdfile');
      res = await window.electronAPI.savePresentationMetadata(slug, mdFile, filtered);
    } else {
      const requestedSlug = slugInput ? slugInput.value.trim() : '';
      const newFiltered = {...filtered, 'createTitleSlide' : createTitle.checked, slug: requestedSlug };
      res = await window.electronAPI.createPresentation(newFiltered);
    }
    result.textContent = res.message;
    result.style.color = 'limegreen';

    if (res.success && res.slug) {
      if (!window.editMode) {
        if (window.electronAPI?.openPresentationBuilder) {
          await window.electronAPI.openPresentationBuilder(res.slug, 'presentation.md');
        }
        // Close the current window (only works in Electron)
        window.close();
      } else {
        // In editMode, navigate back to builder after successful save
        const params = new URLSearchParams({
          dir: presentation_dir,
          slug: slug_editMode,
          md: mdFile_editMode
        });
        window.location.href = `/admin/builder.html?${params.toString()}`;
      }
    }

  } catch (err) {
    console.error('Submission error:', err);
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'color: red; font-weight: bold;';
    errDiv.textContent = `❌ Error: ${err.message || 'Unknown error'}`;
    const pre = document.createElement('pre');
    pre.textContent = (err.stack || err).toString();
    errDiv.appendChild(document.createElement('br'));
    errDiv.appendChild(pre);
    result.innerHTML = '';
    result.appendChild(errDiv);
  }
}

function getValidatedStructure(schemaPart, inputData, parentKey = '') {
  const result = {};
  for (const key in schemaPart) {
    const fullKey = parentKey ? `${parentKey}.${key}` : key;
    const field = schemaPart[key];
    if (field.type === 'object') {
      result[key] = getValidatedStructure(field.fields, inputData, fullKey);
    } 
    else {
      const value = inputData[fullKey];
      let valTyped = null;
      if (value !== undefined) {
        valTyped = coerceType(value, field.type);
      } else if (field.default !== undefined) {
        valTyped = coerceType(field.default, field.type);
      }
      const defaultTyped = coerceType(field.default, field.type);
      if (valTyped !== defaultTyped) {
        result[key] = valTyped;
      } else {
        // If the value matches the default, we skip it
        // This allows us to only include non-default values in the final object
      }
    }
  }
  return result;
}

function coerceType(value, type) {
  switch (type) {
    case "boolean":
      return value === "true" || value === true;
    case "number":
      return Number(value);
    case "integer":
      return parseInt(value, 10);
    default:
      if (typeof value === 'string') {
        return value === 'true' ? true: (value === 'false' ? false : (value === 'null' ? null : value));
      }
      return value;
  }
} // function coerceType

function createThemePicker(key, def, appDefault) {
  const wrapper = document.createElement('div');
  wrapper.className = 'theme-picker';
  wrapper.dataset.expanded = 'false';
  if (def.advanced) {
    wrapper.classList.add('advanced');
  }

  const label = document.createElement('label');
  label.textContent = (def.label && def.label[lang]) ? def.label[lang] : key;
  if (def.doc && def.doc[lang]) label.title = def.doc[lang];
  wrapper.appendChild(label);

  const subtitle = document.createElement('div');
  subtitle.className = 'theme-picker-subtitle';
  subtitle.textContent = 'Choose a visual theme';
  wrapper.appendChild(subtitle);

  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = key;
  input.value = appDefault || '';
  input.dataset.themePicker = 'true';
  wrapper.appendChild(input);

  const header = document.createElement('div');
  header.className = 'theme-picker-header';

  const summary = document.createElement('div');
  summary.className = 'theme-picker-summary';

  const summaryPreview = document.createElement('div');
  summaryPreview.className = 'theme-summary-preview';
  const summaryImg = document.createElement('img');
  summaryImg.alt = 'Theme preview';
  summaryPreview.appendChild(summaryImg);
  summary.appendChild(summaryPreview);

  const summaryText = document.createElement('div');
  summaryText.className = 'theme-summary-text';
  const summaryTitle = document.createElement('div');
  summaryTitle.className = 'theme-summary-title';
  const summaryMeta = document.createElement('div');
  summaryMeta.className = 'theme-summary-meta';
  summaryText.appendChild(summaryTitle);
  summaryText.appendChild(summaryMeta);
  summary.appendChild(summaryText);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'theme-picker-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('data-translate','true');
  toggle.textContent = 'Change theme';

  header.appendChild(summary);
  header.appendChild(toggle);
  wrapper.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'theme-picker-grid';
  grid.setAttribute('role', 'listbox');
  grid.setAttribute('aria-label', label.textContent);
  wrapper.appendChild(grid);

  const footer = document.createElement('div');
  footer.className = 'theme-picker-footer';
  footer.textContent = 'Previews come from /css/theme-thumbnails. Use Debug → Generate Theme Thumbnails if missing.';
  wrapper.appendChild(footer);

  populateThemePicker(grid, input, appDefault);
  toggle.addEventListener('click', () => {
    const isOpen = wrapper.dataset.expanded === 'true';
    wrapper.dataset.expanded = isOpen ? 'false' : 'true';
    toggle.setAttribute('aria-expanded', String(!isOpen));
    toggle.textContent = isOpen ? 'Change theme' : 'Hide themes';
  });
  return wrapper;
}

function buildThemeCard(theme, index, onSelect) {
  const themeBase = theme.replace(/\.css$/i, '');
  const themeLabel = themeBase
    .split(/[-_]+/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'theme-card';
  card.dataset.themeValue = theme;
  card.style.animationDelay = `${index * 30}ms`;
  card.setAttribute('role', 'option');
  card.setAttribute('aria-selected', 'false');

  const preview = document.createElement('div');
  preview.className = 'theme-card-preview';

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.alt = `${themeLabel} preview`;
  img.src = `/css/theme-thumbnails/${themeBase}.jpg`;
  img.onerror = () => {
    img.remove();
    preview.classList.add('theme-card-preview--missing');
    const placeholder = document.createElement('span');
    placeholder.className = 'theme-card-placeholder';
    placeholder.textContent = 'No preview';
    preview.appendChild(placeholder);
  };

  preview.appendChild(img);

  const title = document.createElement('div');
  title.className = 'theme-card-title';
  title.textContent = themeLabel;

  const meta = document.createElement('div');
  meta.className = 'theme-card-meta';
  meta.textContent = theme;

  card.appendChild(preview);
  card.appendChild(title);
  card.appendChild(meta);

  card.addEventListener('click', () => onSelect(theme));
  return card;
}

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

function syncThemePickerInput(input) {
  const wrapper = input.closest('.theme-picker');
  if (!wrapper) return;
  const grid = wrapper.querySelector('.theme-picker-grid');
  if (!grid) return;
  setThemePickerValue(grid, input, input.value, false);
}

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

  summaryTitle.textContent = themeLabel || 'No theme selected';
  summaryMeta.textContent = theme || '—';
  summaryImg.src = theme ? `/css/theme-thumbnails/${themeBase}.jpg` : '';
  summaryImg.onerror = () => {
    summaryImg.removeAttribute('src');
  };
}

function createMedia(field) {
  const wrapper = document.createElement('div');
  wrapper.className = '';

  const label = document.createElement('label');
  label.textContent = field.label && field.label[lang] ? field.label[lang] : 'Media';
  label.style = 'font-weight: bold; display: block; margin-bottom: 1rem;';
  wrapper.appendChild(label);

  const container = document.createElement('div');
  container.id = 'media-container';
  container.style = `
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
    margin-bottom: 1rem;
  `;
  wrapper.appendChild(container);

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.textContent = '+ Add Media';
  addButton.style = `
    padding: 0.6rem 1rem;
    background: #2563eb;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.95rem;
    display: none; // Hidden for now to avoid confusion.
  `;
  addButton.onclick = () => openMediaEditModal(null);
  wrapper.appendChild(addButton);

  const hidden = document.createElement('textarea');
  hidden.name = 'media';
  hidden.id = 'media-json';
  hidden.style = 'display: none;';
  wrapper.appendChild(hidden);

  return wrapper;
}

function renderMediaTiles() {
  const container = document.getElementById('media-container');
  if (!container) return;

  const mediaJson = document.getElementById('media-json');
  if (!mediaJson) return;

  let mediaData = {};

  try {
    if (mediaJson.value) {
      mediaData = JSON.parse(mediaJson.value);
    }
  } catch (e) {
    console.error('Failed to parse media JSON:', e);
  }

  container.innerHTML = '';

  for (const [alias, data] of Object.entries(mediaData)) {
    const tile = document.createElement('div');
    tile.className = 'media-tile';
    tile.style = `
      background: #f5f5f5;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    `;

    const titleRow = document.createElement('div');
    titleRow.style = 'display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;';

    const aliasName = document.createElement('div');
    aliasName.style = 'font-weight: bold; font-size: 1rem; color: #333; word-break: break-word; flex: 1;';
    aliasName.textContent = alias;
    titleRow.appendChild(aliasName);

    const usageCount = mediaUsageCounts[alias] || 0;
    const badge = document.createElement('div');
    badge.style = `
      background: ${usageCount > 0 ? '#2563eb' : '#d1d5db'};
      color: ${usageCount > 0 ? 'white' : '#666'};
      border-radius: 50%;
      width: 1.5rem;
      height: 1.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.8rem;
      font-weight: bold;
      flex-shrink: 0;
    `;
    badge.textContent = usageCount;
    titleRow.appendChild(badge);

    tile.appendChild(titleRow);

    const filename = document.createElement('div');
    filename.style = 'font-size: 0.85rem; color: #666; word-break: break-word;';
    filename.textContent = data.filename || '(no file)';
    tile.appendChild(filename);

    if (data.mediatype) {
      const type = document.createElement('div');
      type.style = 'font-size: 0.75rem; color: #999; text-transform: uppercase; letter-spacing: 0.5px;';
      type.textContent = data.mediatype;
      tile.appendChild(type);
    }

    const actions = document.createElement('div');
    actions.style = 'display: flex; gap: 0.5rem; margin-top: 0.5rem;';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = '✎ Edit';
    editBtn.style = `
      flex: 1;
      padding: 0.4rem 0.6rem;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
    `;
    editBtn.onclick = () => openMediaEditModal(alias);
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = '✕ Delete';
    deleteBtn.style = `
      flex: 1;
      padding: 0.4rem 0.6rem;
      background: #ef4444;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
    `;
    deleteBtn.onclick = () => deleteMediaItem(alias);
    actions.appendChild(deleteBtn);

    tile.appendChild(actions);
    container.appendChild(tile);
  }
}

function openMediaEditModal(alias) {
  const mediaJson = document.getElementById('media-json');
  let mediaData = {};

  try {
    if (mediaJson.value) {
      mediaData = JSON.parse(mediaJson.value);
    }
  } catch (e) {
    console.error('Failed to parse media JSON:', e);
  }

  const currentData = alias ? (mediaData[alias] || {}) : {};

  const overlay = document.createElement('div');
  overlay.id = 'media-modal-overlay';
  overlay.style = `
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  `;

  const modal = document.createElement('div');
  modal.style = `
    width: min(600px, 100%);
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 10px;
    padding: 1.5rem;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3);
    max-height: 80vh;
    overflow-y: auto;
  `;

  const titleBar = document.createElement('div');
  titleBar.style = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;';

  const title = document.createElement('h3');
  title.textContent = alias ? `Edit Media: ${alias}` : 'Add New Media';
  title.style = 'margin: 0; color: #333; flex: 1;';
  titleBar.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.style = `
    background: none;
    border: none;
    font-size: 1.5rem;
    color: #666;
    cursor: pointer;
    padding: 0;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 150ms ease;
  `;
  closeBtn.onmouseover = () => {
    closeBtn.style.background = '#e5e7eb';
    closeBtn.style.color = '#000';
  };
  closeBtn.onmouseout = () => {
    closeBtn.style.background = 'none';
    closeBtn.style.color = '#666';
  };
  closeBtn.onclick = () => {
    overlay.remove();
  };
  titleBar.appendChild(closeBtn);

  modal.appendChild(titleBar);

  const form = document.createElement('form');
  form.style = 'display: flex; flex-direction: column; gap: 1rem;';

  // Alias name field
  const aliasGroup = document.createElement('div');
  const aliasLabel = document.createElement('label');
  aliasLabel.textContent = 'Alias (key name)';
  aliasLabel.style = 'font-weight: bold; color: #333; display: block; margin-bottom: 0.3rem;';
  const aliasInput = document.createElement('input');
  aliasInput.type = 'text';
  aliasInput.value = alias || '';
  aliasInput.placeholder = 'e.g., galaxies, intro, background';
  aliasInput.style = `
    width: 100%;
    padding: 0.6rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-sizing: border-box;
    font-family: monospace;
  `;
  aliasGroup.appendChild(aliasLabel);
  aliasGroup.appendChild(aliasInput);
  form.appendChild(aliasGroup);

  // Filename field
  const filenameGroup = document.createElement('div');
  const filenameLabel = document.createElement('label');
  filenameLabel.textContent = 'Filename';
  filenameLabel.style = 'font-weight: bold; color: #333; display: block; margin-bottom: 0.3rem;';
  const filenameInput = document.createElement('input');
  filenameInput.type = 'text';
  filenameInput.value = currentData.filename || '';
  filenameInput.placeholder = 'e.g., video.mp4 or hash.webm';
  filenameInput.style = `
    width: 100%;
    padding: 0.6rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-sizing: border-box;
  `;
  filenameGroup.appendChild(filenameLabel);
  filenameGroup.appendChild(filenameInput);
  form.appendChild(filenameGroup);

  // Title field
  const titleGroup = document.createElement('div');
  const titleLabel = document.createElement('label');
  titleLabel.textContent = 'Title';
  titleLabel.style = 'font-weight: bold; color: #333; display: block; margin-bottom: 0.3rem;';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.value = currentData.title || '';
  titleInput.placeholder = 'Media title';
  titleInput.style = `
    width: 100%;
    padding: 0.6rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-sizing: border-box;
  `;
  titleGroup.appendChild(titleLabel);
  titleGroup.appendChild(titleInput);
  form.appendChild(titleGroup);

  // Media type field
  const typeGroup = document.createElement('div');
  const typeLabel = document.createElement('label');
  typeLabel.textContent = 'Media Type';
  typeLabel.style = 'font-weight: bold; color: #333; display: block; margin-bottom: 0.3rem;';
  const typeSelect = document.createElement('select');
  typeSelect.style = `
    width: 100%;
    padding: 0.6rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-sizing: border-box;
  `;
  ['audio', 'video', 'image', 'other'].forEach(type => {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type.charAt(0).toUpperCase() + type.slice(1);
    if (currentData.mediatype === type) option.selected = true;
    typeSelect.appendChild(option);
  });
  typeGroup.appendChild(typeLabel);
  typeGroup.appendChild(typeSelect);
  form.appendChild(typeGroup);

  // Description field
  const descGroup = document.createElement('div');
  const descLabel = document.createElement('label');
  descLabel.textContent = 'Description';
  descLabel.style = 'font-weight: bold; color: #333; display: block; margin-bottom: 0.3rem;';
  const descInput = document.createElement('textarea');
  descInput.value = currentData.description || '';
  descInput.placeholder = 'Description of the media';
  descInput.style = `
    width: 100%;
    padding: 0.6rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-sizing: border-box;
    min-height: 80px;
    font-family: inherit;
  `;
  descGroup.appendChild(descLabel);
  descGroup.appendChild(descInput);
  form.appendChild(descGroup);

  // Attribution field
  const attrGroup = document.createElement('div');
  const attrLabel = document.createElement('label');
  attrLabel.textContent = 'Attribution';
  attrLabel.style = 'font-weight: bold; color: #333; display: block; margin-bottom: 0.3rem;';
  const attrInput = document.createElement('input');
  attrInput.type = 'text';
  attrInput.value = currentData.attribution || '';
  attrInput.placeholder = 'e.g., NASA, CC-BY';
  attrInput.style = `
    width: 100%;
    padding: 0.6rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-sizing: border-box;
  `;
  attrGroup.appendChild(attrLabel);
  attrGroup.appendChild(attrInput);
  form.appendChild(attrGroup);

  // License field
  const licenseGroup = document.createElement('div');
  const licenseLabel = document.createElement('label');
  licenseLabel.textContent = 'License';
  licenseLabel.style = 'font-weight: bold; color: #333; display: block; margin-bottom: 0.3rem;';
  const licenseInput = document.createElement('input');
  licenseInput.type = 'text';
  licenseInput.value = currentData.license || '';
  licenseInput.placeholder = 'e.g., CC-BY, MIT, Public Domain';
  licenseInput.style = `
    width: 100%;
    padding: 0.6rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-sizing: border-box;
  `;
  licenseGroup.appendChild(licenseLabel);
  licenseGroup.appendChild(licenseInput);
  form.appendChild(licenseGroup);

  const buttonGroup = document.createElement('div');
  buttonGroup.style = 'display: flex; gap: 0.6rem; justify-content: flex-end; margin-top: 1rem;';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style = `
    padding: 0.6rem 1.2rem;
    background: #e5e7eb;
    color: #333;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.95rem;
  `;
  cancelBtn.onclick = () => {
    overlay.remove();
  };
  buttonGroup.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  saveBtn.style = `
    padding: 0.6rem 1.2rem;
    background: #2563eb;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.95rem;
  `;
  saveBtn.onclick = () => {
    const newAlias = aliasInput.value.trim();
    if (!newAlias) {
      alert('Alias name is required');
      return;
    }

    // Validate alias format (alphanumeric and underscore only)
    if (!/^[a-zA-Z0-9_]+$/.test(newAlias)) {
      alert('Alias can only contain letters, numbers, and underscores');
      aliasInput.focus();
      return;
    }

    // Check for duplicate alias
    if (mediaData[newAlias] && newAlias !== alias) {
      alert(`An alias named "${newAlias}" already exists`);
      return;
    }

    // Warn if renaming an alias that has references
    if (alias && newAlias !== alias) {
      const usageCount = mediaUsageCounts[alias] || 0;
      if (usageCount > 0) {
        const message = `This alias appears to be referenced ${usageCount} time${usageCount !== 1 ? 's' : ''} in the markdown. Renaming it will break those references. Are you sure?`;
        if (!confirm(message)) {
          return;
        }
      }
    }

    // Start with existing data to preserve fields we're not editing (url_origin, url_library, etc)
    const updatedItem = { ...currentData };
    updatedItem.filename = filenameInput.value.trim();
    updatedItem.title = titleInput.value.trim();
    updatedItem.mediatype = typeSelect.value;
    updatedItem.description = descInput.value.trim();
    updatedItem.attribution = attrInput.value.trim();
    updatedItem.license = licenseInput.value.trim();

    // If editing and alias name changed, delete old key
    if (alias && alias !== newAlias) {
      delete mediaData[alias];
    }

    mediaData[newAlias] = updatedItem;
    document.getElementById('media-json').value = JSON.stringify(mediaData, null, 2);

    overlay.remove();
    renderMediaTiles();
  };
  buttonGroup.appendChild(saveBtn);

  form.appendChild(buttonGroup);
  modal.appendChild(form);
  overlay.appendChild(modal);

  // Close on ESC key
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);

  document.body.appendChild(overlay);
}

function deleteMediaItem(alias) {
  const usageCount = mediaUsageCounts[alias] || 0;

  let shouldDelete = false;

  if (usageCount === 0) {
    // No references, delete immediately without confirmation
    shouldDelete = true;
  } else {
    // Has references, show warning
    const message = `This alias appears to be referenced ${usageCount} time${usageCount !== 1 ? 's' : ''} in the markdown. Deleting it will likely leave your presentation broken. Are you sure?`;
    shouldDelete = confirm(message);
  }

  if (!shouldDelete) {
    return;
  }

  const mediaJson = document.getElementById('media-json');
  let mediaData = {};

  try {
    if (mediaJson.value) {
      mediaData = JSON.parse(mediaJson.value);
    }
  } catch (e) {
    console.error('Failed to parse media JSON:', e);
  }

  delete mediaData[alias];
  mediaJson.value = JSON.stringify(mediaData, null, 2);
  renderMediaTiles();
}

// --- Macros tile-based editor ---
const RESERVED_MACRO_NAMES = new Set([
  // Layout and styling
  'darkbg', 'lightbg', 'darktext', 'lighttext',
  'upperthird', 'lowerthird',
  'shiftright', 'shiftleft', 'shiftnone',
  'info', 'infofull',
  // Effects
  'animate', 'autoslide', 'transition',
  'bgtint', 'clearbg', 'nobg', 'nothird',
  // Media and metadata
  'audio', 'caption', 'attrib', 'ai',
  // Timing
  'countdown'
]);

function createMacros(field) {
  const wrapper = document.createElement('div');
  wrapper.className = '';

  const label = document.createElement('label');
  label.textContent = field.label && field.label[lang] ? field.label[lang] : 'Macros';
  label.style = 'font-weight: bold; display: block; margin-bottom: 1rem;';
  wrapper.appendChild(label);

  const container = document.createElement('div');
  container.id = 'macros-container';
  container.style = `
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
    margin-bottom: 1rem;
  `;
  wrapper.appendChild(container);

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.textContent = '+ Add Macro';
  addButton.style = `
    padding: 0.6rem 1rem;
    background: #2563eb;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.95rem;
  `;
  addButton.onclick = () => openMacroEditModal(null);
  wrapper.appendChild(addButton);

  const hidden = document.createElement('textarea');
  hidden.name = 'macros';
  hidden.id = 'macros-json';
  hidden.style = 'display: none;';
  wrapper.appendChild(hidden);

  return wrapper;
}

function renderMacroTiles() {
  const container = document.getElementById('macros-container');
  if (!container) return;

  const macrosJson = document.getElementById('macros-json');
  if (!macrosJson) return;

  let macrosData = {};

  try {
    if (macrosJson.value) {
      macrosData = JSON.parse(macrosJson.value);
    }
  } catch (e) {
    console.error('Failed to parse macros JSON:', e);
  }

  container.innerHTML = '';

  for (const [name, code] of Object.entries(macrosData)) {
    const tile = document.createElement('div');
    tile.className = 'macro-tile';
    tile.style = `
      background: #f5f5f5;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    `;

    const nameRow = document.createElement('div');
    nameRow.style = 'display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;';

    const macroName = document.createElement('div');
    macroName.style = 'font-weight: bold; font-size: 1rem; color: #333; word-break: break-word; flex: 1; font-family: monospace;';
    macroName.textContent = `{{${name}}}`;
    nameRow.appendChild(macroName);

    tile.appendChild(nameRow);

    const codePreview = document.createElement('div');
    codePreview.style = `
      font-size: 0.8rem;
      color: #666;
      background: #fff;
      padding: 0.6rem;
      border-radius: 4px;
      border: 1px solid #e5e7eb;
      max-height: 60px;
      overflow: hidden;
      word-break: break-all;
      font-family: monospace;
      line-height: 1.3;
    `;
    codePreview.textContent = String(code || '').substring(0, 150) + (String(code || '').length > 150 ? '…' : '');
    tile.appendChild(codePreview);

    const actions = document.createElement('div');
    actions.style = 'display: flex; gap: 0.5rem; margin-top: 0.5rem;';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = '✎ Edit';
    editBtn.style = `
      flex: 1;
      padding: 0.4rem 0.6rem;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
    `;
    editBtn.onclick = () => openMacroEditModal(name);
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = '✕ Delete';
    deleteBtn.style = `
      flex: 1;
      padding: 0.4rem 0.6rem;
      background: #ef4444;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
    `;
    deleteBtn.onclick = () => deleteMacroItem(name);
    actions.appendChild(deleteBtn);

    tile.appendChild(actions);
    container.appendChild(tile);
  }
}

function createImports(field) {
  const wrapper = document.createElement('div');
  wrapper.className = '';

  const label = document.createElement('label');
  label.textContent = field.label && field.label[lang] ? field.label[lang] : 'Imports';
  label.style = 'font-weight: bold; display: block; margin-bottom: 1rem;';
  wrapper.appendChild(label);

  const infoBox = document.createElement('div');
  infoBox.style = `
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 6px;
    font-size: 0.9rem;
    color: #1e40af;
    line-height: 1.5;
  `;
  infoBox.innerHTML = `
    <strong>About Imports:</strong><br>
    Imports allow you to share macros and media definitions across multiple presentations.
    <br><br>
    <strong>Save:</strong> Saves your current macros and media to a file, then clears both inline versions and links the imports file.
    <br><br>
    <strong>Import:</strong> Loads macros and media from an existing file into your inline definitions.
  `;
  wrapper.appendChild(infoBox);

  const importsSection = document.createElement('div');
  importsSection.style = 'padding: 1rem; background: #f9fafb; border-radius: 6px; border: 1px solid #e5e7eb;';

  const importsInput = document.createElement('input');
  importsInput.type = 'text';
  importsInput.name = 'imports';
  importsInput.id = 'imports-input';
  importsInput.placeholder = 'Path to imports file (relative to presentation directory)';
  importsInput.style = `
    width: 100%;
    padding: 0.6rem;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    font-family: monospace;
    font-size: 0.9rem;
    margin-bottom: 1rem;
    box-sizing: border-box;
  `;
  importsSection.appendChild(importsInput);

  const buttonRow = document.createElement('div');
  buttonRow.style = 'display: flex; gap: 0.5rem; flex-wrap: wrap;';

  const browseBtn = document.createElement('button');
  browseBtn.type = 'button';
  browseBtn.textContent = 'Browse';
  browseBtn.style = `
    padding: 0.6rem 1rem;
    background: #6b7280;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
  `;
  browseBtn.onclick = () => selectImportsFileDialog(importsInput);
  buttonRow.appendChild(browseBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = '💾 Save Current';
  saveBtn.style = `
    padding: 0.6rem 1rem;
    background: #10b981;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
  `;
  saveBtn.onclick = () => saveResourcesToFile(importsInput);
  buttonRow.appendChild(saveBtn);

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.textContent = '📂 Import';
  importBtn.style = `
    padding: 0.6rem 1rem;
    background: #f59e0b;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
  `;
  importBtn.onclick = () => importResourcesFromFile(importsInput);
  buttonRow.appendChild(importBtn);

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.textContent = '✎ Edit';
  editBtn.style = `
    padding: 0.6rem 1rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
    display: none;
  `;
  editBtn.id = 'imports-edit-btn';
  editBtn.onclick = () => openImportsFileInEditor(importsInput.value);
  buttonRow.appendChild(editBtn);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = '✕ Clear';
  clearBtn.style = `
    padding: 0.6rem 1rem;
    background: #ef4444;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
    display: none;
  `;
  clearBtn.id = 'imports-clear-btn';
  clearBtn.onclick = () => {
    importsInput.value = '';
    updateImportsUI();
    importsInput.dispatchEvent(new Event('change', { bubbles: true }));
  };
  buttonRow.appendChild(clearBtn);

  importsSection.appendChild(buttonRow);
  wrapper.appendChild(importsSection);

  function updateImportsUI() {
    const hasFile = importsInput.value && importsInput.value.trim();
    const editBtn = document.getElementById('imports-edit-btn');
    const clearBtn = document.getElementById('imports-clear-btn');
    if (editBtn) editBtn.style.display = hasFile ? 'block' : 'none';
    if (clearBtn) clearBtn.style.display = hasFile ? 'block' : 'none';
  }

  importsInput.addEventListener('input', updateImportsUI);
  importsInput.addEventListener('change', updateImportsUI);

  return wrapper;
}

function openMacroEditModal(macroName) {
  const macrosJson = document.getElementById('macros-json');
  let macrosData = {};

  try {
    if (macrosJson.value) {
      macrosData = JSON.parse(macrosJson.value);
    }
  } catch (e) {
    console.error('Failed to parse macros JSON:', e);
  }

  const currentCode = macroName ? (macrosData[macroName] || '') : '';

  const overlay = document.createElement('div');
  overlay.id = 'macro-modal-overlay';
  overlay.style = `
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  `;

  const modal = document.createElement('div');
  modal.style = `
    width: min(700px, 100%);
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 10px;
    padding: 1.5rem;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3);
    max-height: 80vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  `;

  const titleBar = document.createElement('div');
  titleBar.style = 'display: flex; justify-content: space-between; align-items: center;';

  const title = document.createElement('h3');
  title.textContent = macroName ? `Edit Macro: {{${macroName}}}` : 'Add New Macro';
  title.style = 'margin: 0; color: #333; flex: 1;';
  titleBar.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.style = `
    background: none;
    border: none;
    font-size: 1.5rem;
    color: #666;
    cursor: pointer;
    padding: 0;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 150ms ease;
  `;
  closeBtn.onmouseover = () => {
    closeBtn.style.background = '#e5e7eb';
    closeBtn.style.color = '#000';
  };
  closeBtn.onmouseout = () => {
    closeBtn.style.background = 'none';
    closeBtn.style.color = '#666';
  };
  closeBtn.onclick = () => {
    overlay.remove();
  };
  titleBar.appendChild(closeBtn);
  modal.appendChild(titleBar);

  const form = document.createElement('form');
  form.style = 'display: flex; flex-direction: column; gap: 1rem; flex: 1;';

  // Macro name field
  const nameGroup = document.createElement('div');
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Macro Name';
  nameLabel.style = 'font-weight: bold; color: #333; display: block; margin-bottom: 0.3rem;';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = macroName || '';
  nameInput.placeholder = 'e.g., my_signature';
  nameInput.style = `
    width: 100%;
    padding: 0.6rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-sizing: border-box;
    font-family: monospace;
  `;
  if (macroName) {
    nameInput.readOnly = true;
    nameInput.title = 'Macro name cannot be changed after creation.';
  }
  nameGroup.appendChild(nameLabel);
  nameGroup.appendChild(nameInput);

  // Reserved names warning
  const reservedNote = document.createElement('div');
  reservedNote.style = `
    font-size: 0.8rem;
    color: #666;
    margin-top: 0.3rem;
    cursor: help;
    text-decoration: underline dotted #999;
    position: relative;
  `;
  reservedNote.textContent = 'ⓘ Avoid reserved names';
  reservedNote.title = `Reserved macro names: ${Array.from(RESERVED_MACRO_NAMES).sort().join(', ')}`;
  nameGroup.appendChild(reservedNote);

  form.appendChild(nameGroup);

  // Help text
  const helpText = document.createElement('div');
  helpText.style = 'font-size: 0.85rem; color: #666; background: #f9fafb; padding: 0.8rem; border-radius: 4px; border-left: 3px solid #3b82f6;';
  helpText.innerHTML = `
    <strong>Macro Code:</strong> Enter Handlebars/Reveal.js configuration syntax.<br>
    <a href="#" style="color: #3b82f6; text-decoration: none;" onclick="return window.electronAPI?.openHandoutView ? (window.electronAPI.openHandoutView('readme', 'revelation-doc-authoring_reference.md'), false) : true;">
      Learn about macros →
    </a>
  `;
  form.appendChild(helpText);

  // Code editor field
  const codeGroup = document.createElement('div');
  codeGroup.style = 'flex: 1; display: flex; flex-direction: column;';
  const codeLabel = document.createElement('label');
  codeLabel.textContent = 'Macro Code';
  codeLabel.style = 'font-weight: bold; color: #333; display: block; margin-bottom: 0.3rem;';
  const codeInput = document.createElement('textarea');
  codeInput.value = currentCode;
  codeInput.placeholder = 'Enter the macro code/value here.\nExample: {{darkbg}} or {{transition:fade}}';
  codeInput.style = `
    width: 100%;
    padding: 0.6rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-sizing: border-box;
    font-family: monospace;
    font-size: 0.9rem;
    flex: 1;
    min-height: 200px;
    resize: none;
  `;
  codeGroup.appendChild(codeLabel);
  codeGroup.appendChild(codeInput);
  form.appendChild(codeGroup);

  // Preview
  const previewGroup = document.createElement('div');
  previewGroup.style = 'display: flex; flex-direction: column; gap: 0.3rem;';
  const previewLabel = document.createElement('label');
  previewLabel.textContent = 'Preview';
  previewLabel.style = 'font-weight: bold; color: #333; display: block;';
  const previewBox = document.createElement('div');
  previewBox.style = `
    width: 100%;
    padding: 0.6rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #f5f5f5;
    font-family: monospace;
    font-size: 0.9rem;
    color: #333;
    word-break: break-all;
  `;
  previewBox.textContent = `{{${nameInput.value || 'macroname'}}}`;
  previewGroup.appendChild(previewLabel);
  previewGroup.appendChild(previewBox);
  form.appendChild(previewGroup);

  // Update preview on name/code change
  const updatePreview = () => {
    previewBox.textContent = `{{${nameInput.value || 'macroname'}}}`;
  };
  nameInput.addEventListener('input', updatePreview);

  modal.appendChild(form);

  // Button group
  const buttonGroup = document.createElement('div');
  buttonGroup.style = 'display: flex; gap: 0.6rem; justify-content: flex-end;';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style = `
    padding: 0.6rem 1.2rem;
    background: #e5e7eb;
    color: #333;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.95rem;
  `;
  cancelBtn.onclick = () => {
    overlay.remove();
  };
  buttonGroup.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  saveBtn.style = `
    padding: 0.6rem 1.2rem;
    background: #2563eb;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.95rem;
  `;
  saveBtn.onclick = () => {
    const newName = nameInput.value.trim();
    const newCode = codeInput.value.trim();

    if (!newName) {
      alert('Macro name is required');
      return;
    }

    // Validate macro name format (alphanumeric and underscore/hyphen only)
    if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
      alert('Macro name can only contain letters, numbers, underscores, and hyphens');
      nameInput.focus();
      return;
    }

    // Check for reserved macro names
    if (RESERVED_MACRO_NAMES.has(newName.toLowerCase())) {
      alert(`"${newName}" is a reserved macro name. Please choose a different name.\n\nReserved names: ${Array.from(RESERVED_MACRO_NAMES).sort().join(', ')}`);
      nameInput.focus();
      return;
    }

    if (!newCode) {
      alert('Macro code/value is required');
      return;
    }

    // Check for duplicate name (only if creating new)
    if (!macroName && macrosData[newName]) {
      alert(`A macro named "${newName}" already exists`);
      return;
    }

    // If editing and name changed, delete old key
    if (macroName && newName !== macroName) {
      delete macrosData[macroName];
    }

    macrosData[newName] = newCode;
    document.getElementById('macros-json').value = JSON.stringify(macrosData, null, 2);
    formDirty = true;

    overlay.remove();
    renderMacroTiles();
  };
  buttonGroup.appendChild(saveBtn);

  modal.appendChild(buttonGroup);
  overlay.appendChild(modal);

  // Close on ESC key
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);

  document.body.appendChild(overlay);

  // Focus on name input (or code if editing)
  if (!macroName) {
    nameInput.focus();
  } else {
    codeInput.focus();
  }
}

function deleteMacroItem(macroName) {
  if (!confirm(`Delete macro "{{${macroName}}}"?`)) {
    return;
  }

  const macrosJson = document.getElementById('macros-json');
  let macrosData = {};

  try {
    if (macrosJson.value) {
      macrosData = JSON.parse(macrosJson.value);
    }
  } catch (e) {
    console.error('Failed to parse macros JSON:', e);
  }

  delete macrosData[macroName];
  macrosJson.value = JSON.stringify(macrosData, null, 2);
  formDirty = true;
  renderMacroTiles();
}

async function selectImportsFileDialog(inputElement) {
  try {
    const slug = window.editMode ? slug_editMode : '';
    const result = await window.electronAPI.selectMacroFile(slug);

    if (result.success && result.filename) {
      inputElement.value = result.filename;
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));
      formDirty = true;
    } else if (!result.canceled) {
      console.error('Failed to select imports file:', result.error);
    }
  } catch (err) {
    console.error('Error in selectImportsFileDialog:', err);
  }
}

async function selectMacroFileDialog(inputElement) {
  try {
    const slug = window.editMode ? slug_editMode : '';

    const result = await window.electronAPI.selectMacroFile(slug);

    if (result.success && result.filename) {
      inputElement.value = result.filename;
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));
      formDirty = true;
    } else if (!result.canceled) {
      console.error('Failed to select macro file:', result.error);
    }
  } catch (err) {
    console.error('Error in selectMacroFileDialog:', err);
  }
}

async function openImportsFileInEditor(relativePath) {
  if (!relativePath || !relativePath.trim()) {
    console.warn('No imports file specified');
    return;
  }

  try {
    console.log(`[Imports] Opening external editor for: ${relativePath}`);
    const result = await window.electronAPI.openFileWithEditor(relativePath, slug_editMode);

    if (!result.success) {
      console.error('Failed to open file:', result.error);
      alert(`Could not open file: ${result.error}`);
    }
  } catch (err) {
    console.error('Error opening imports file:', err);
    alert('Error opening imports file: ' + err.message);
  }
}

async function openMacroFileInEditor(relativePath) {
  if (!relativePath || !relativePath.trim()) {
    console.warn('No external macro file specified');
    return;
  }

  try {
    console.log(`[Macros] Opening external editor for: ${relativePath}`);
    const result = await window.electronAPI.openFileWithEditor(relativePath, slug_editMode);

    if (!result.success) {
      console.error('Failed to open file:', result.error);
      alert(`Could not open file: ${result.error}`);
    }
  } catch (err) {
    console.error('Error opening macro file:', err);
    alert('Error opening macro file: ' + err.message);
  }
}

async function saveResourcesToFile(inputElement) {
  try {
    const macrosJson = document.getElementById('macros-json');
    const mediaJson = document.getElementById('media-json');

    let macrosObject = {};
    let mediaObject = {};

    if (macrosJson && macrosJson.value) {
      try {
        macrosObject = JSON.parse(macrosJson.value);
      } catch (err) {
        alert('Invalid macros JSON. Please fix any errors in your macros.');
        console.error('Failed to parse macros:', err);
        return;
      }
    }

    if (mediaJson && mediaJson.value) {
      try {
        mediaObject = JSON.parse(mediaJson.value);
      } catch (err) {
        alert('Invalid media JSON. Please fix any errors in your media.');
        console.error('Failed to parse media:', err);
        return;
      }
    }

    if (Object.keys(macrosObject).length === 0 && Object.keys(mediaObject).length === 0) {
      alert('No macros or media defined to save. Add some first.');
      return;
    }

    const slug = window.editMode ? slug_editMode : '';
    const importsData = {};
    if (Object.keys(macrosObject).length > 0) {
      importsData.macros = macrosObject;
    }
    if (Object.keys(mediaObject).length > 0) {
      importsData.media = mediaObject;
    }

    const result = await window.electronAPI.saveMacrosToFile(importsData, slug, 'shared-resources.yaml');

    if (result.success) {
      inputElement.value = result.filename;
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));

      if (macrosJson) macrosJson.value = '';
      if (mediaJson) mediaJson.value = '';
      renderMacroTiles();
      renderMediaTiles();

      formDirty = true;
      const count = `${Object.keys(macrosObject).length} macro(s)${Object.keys(mediaObject).length > 0 ? ' and ' + Object.keys(mediaObject).length + ' media item(s)' : ''}`;
      alert(`Resources saved to: ${result.filename}\n\nInline macros and media have been cleared. You can now edit the imports file or keep using it as-is.`);
    } else {
      console.error('Failed to save resources:', result.error);
      alert(`Failed to save resources: ${result.error}`);
    }
  } catch (err) {
    console.error('Error in saveResourcesToFile:', err);
    alert('Error saving resources: ' + err.message);
  }
}

async function importResourcesFromFile(inputElement) {
  try {
    const slug = window.editMode ? slug_editMode : '';

    const selectResult = await window.electronAPI.selectMacroFile(slug);

    if (!selectResult.success) {
      if (!selectResult.canceled) {
        alert(`Failed to select file: ${selectResult.error}`);
      }
      return;
    }

    const filename = selectResult.filename;
    const isAbsolute = selectResult.isAbsolute || filename.startsWith('/');

    let fullPath = filename;
    if (!isAbsolute && window.editMode && presentation_dir && slug_editMode) {
      fullPath = presentation_dir + '/' + slug_editMode + '/' + filename;
    }

    const loadResult = await window.electronAPI.loadMacrosFromFile(fullPath);

    if (loadResult.success) {
      const macrosJson = document.getElementById('macros-json');
      const mediaJson = document.getElementById('media-json');

      if (loadResult.macros && typeof loadResult.macros === 'object') {
        if (macrosJson) {
          macrosJson.value = JSON.stringify(loadResult.macros, null, 2);
          renderMacroTiles();
        }
      }

      if (loadResult.media && typeof loadResult.media === 'object') {
        if (mediaJson) {
          mediaJson.value = JSON.stringify(loadResult.media, null, 2);
          renderMediaTiles();
        }
      }

      inputElement.value = filename;
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));

      formDirty = true;
      const macroCount = (loadResult.macros && Object.keys(loadResult.macros).length) || 0;
      const mediaCount = (loadResult.media && Object.keys(loadResult.media).length) || 0;
      alert(`Imported ${macroCount} macro(s) and ${mediaCount} media item(s).`);
    } else {
      alert(`Failed to load resources: ${loadResult.error || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('Error in importResourcesFromFile:', err);
    alert('Error importing resources: ' + err.message);
  }
}

async function saveMacroSetToFile() {
  try {
    // Get current macros from the form
    const macrosJson = document.getElementById('macros-json');
    if (!macrosJson || !macrosJson.value) {
      alert('No macros defined to save. Add macros first.');
      return;
    }

    let macrosObject = {};
    try {
      macrosObject = JSON.parse(macrosJson.value);
    } catch (err) {
      alert('Invalid macros JSON. Please fix any errors in your macros.');
      console.error('Failed to parse macros:', err);
      return;
    }

    const slug = window.editMode ? slug_editMode : '';

    // Save to file
    const result = await window.electronAPI.saveMacrosToFile(macrosObject, slug, 'macros.yaml');

    if (result.success) {
      // Update the external macros field
      const externalInput = document.getElementById('macros-external-input');
      if (externalInput) {
        externalInput.value = result.filename;
        externalInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Clear inline macros
      macrosJson.value = '';
      renderMacroTiles();

      formDirty = true;
      alert(`Macros saved to: ${result.filename}\n\nInline macros have been cleared. You can now edit the external file or keep using it as-is.`);
    } else {
      console.error('Failed to save macros:', result.error);
      alert(`Failed to save macro set: ${result.error}`);
    }
  } catch (err) {
    console.error('Error in saveMacroSetToFile:', err);
    alert('Error saving macro set: ' + err.message);
  }
}

async function importMacroSetFromFile() {
  try {
    const slug = window.editMode ? slug_editMode : '';

    // Select file
    const selectResult = await window.electronAPI.selectMacroFile(slug);

    if (!selectResult.success) {
      if (!selectResult.canceled) {
        alert(`Failed to select file: ${selectResult.error}`);
      }
      return;
    }

    const filename = selectResult.filename;
    const isAbsolute = selectResult.isAbsolute || filename.startsWith('/');

    let fullPath = filename;
    if (!isAbsolute && window.editMode && presentation_dir && slug_editMode) {
      fullPath = presentation_dir + '/' + slug_editMode + '/' + filename;
    }

    // Load macros from file
    const loadResult = await window.electronAPI.loadMacrosFromFile(fullPath);

    if (loadResult.success && loadResult.macros && typeof loadResult.macros === 'object') {
      // Update inline macros
      const macrosJson = document.getElementById('macros-json');
      if (macrosJson) {
        macrosJson.value = JSON.stringify(loadResult.macros, null, 2);
        renderMacroTiles();
      }

      formDirty = true;
      alert(`Imported ${Object.keys(loadResult.macros).length} macro(s) into inline macros.`);
    } else {
      alert(`Failed to load macros: ${loadResult.error || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('Error in importMacroSetFromFile:', err);
    alert('Error importing macro set: ' + err.message);
  }
}

if (!window.translationsources) {
  window.translationsources = [];
}
window.translationsources.push('/admin/locales/translations.json');
