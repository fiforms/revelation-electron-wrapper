/*
 * Setup tab of the Create / Edit Metadata form: friendly controls over config.* fields.
 *
 * Builds the aspect-ratio and zoom sliders (which write config.width/height and derive
 * config.maxScale/minScale), the "Auto Mode" group (config.autoSlide/loop/shuffle/
 * autoSlideStoppable), the transition/speed/background-transition/auto-animate-easing dropdowns
 * that mirror the Advanced-tab selects, the two sample-slide preview and the transition and
 * auto-animate demos. The Advanced inputs stay the source of truth; this tab reads and writes
 * them by `name` via formState.form.
 *
 * Static markup (layout, sliders, auto-mode tile, select group, sample stages) comes from the
 * tpl-setup-* templates in create/templates.html via cloneTemplate(); the slider math, option
 * lists and demo animations stay here.
 *
 * Callers: create.js buildFormWithTabs() calls buildSetupTab(); edit-mode load calls
 * syncSetupFromInputs() after setValues(). Uses /js/easings.js and /js/transitions.js (absolute
 * imports, so this module only loads in the browser).
 *
 * Gotchas: build the Advanced tab first (the controls look up `[name="config.*"]` inputs);
 * `setupControls` is module-local and null until buildSetupTab() has run.
 */
import { AUTO_ANIMATE_EASINGS, resolveEasing, findEasingByCss } from '/js/easings.js';
import { getTransition, transitionLabel, demoKeyframes, TRANSITION_DURATIONS } from '/js/transitions.js';
import { formState, lang, t, tf, cloneTemplate } from './metadata-form-core.js';

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
// `demo` selects replay the slide transition preview when changed. The grid has three
// columns (select, select, button); `row` is 1 for the first line, 2 for the second.
const SETUP_SELECTS = [
  { name: 'config.transition', label: 'Slide Transition', field: 'transition', demo: true, row: 1 },
  { name: 'config.transitionSpeed', label: 'Transition Speed', field: 'transitionSpeed', demo: true, row: 1 },
  { name: 'config.backgroundTransition', label: 'Background Transition', field: 'backgroundTransition', demo: false, row: 2 }
];

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

// Inverse of zoomPositionToHeight: slider position for a slide height (clamped to the zoom range).
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

// Inverse of aspectPositionToRatio: fractional slider position for an aspect ratio.
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
  const autoSlideSrc = formState.form.querySelector('[name="config.autoSlide"]');
  const loopSrc = formState.form.querySelector('[name="config.loop"]');
  const shuffleSrc = formState.form.querySelector('[name="config.shuffle"]');
  const indicatorSrc = formState.form.querySelector('[name="config.autoSlideStoppable"]');
  if (!autoSlideSrc || !loopSrc || !indicatorSrc) return null;

  const group = cloneTemplate('tpl-setup-auto-mode');
  const checkbox = (role) => {
    const input = group.querySelector(`[data-role="${role}"]`);
    return { row: input.parentElement, input };
  };
  const enable = checkbox('enable');

  // Always visible and independent of auto-advance (e.g. a deck of cards you flip through)
  const shuffle = checkbox('shuffle');
  if (!shuffleSrc) shuffle.row.hidden = true;

  // Options only appear once Advance Automatically is checked
  const options = group.querySelector('[data-role="options"]');
  const seconds = group.querySelector('[data-role="seconds"]');
  seconds.value = String(AUTO_MODE_DEFAULT_SECONDS);

  const loop = checkbox('loop');
  const indicator = checkbox('indicator');

  const sync = () => {
    const ms = Number(autoSlideSrc.value) || 0;
    const on = ms > 0;
    enable.input.checked = on;
    if (on) seconds.value = String(ms / 1000);
    loop.input.checked = loopSrc.checked;
    if (shuffleSrc) shuffle.input.checked = shuffleSrc.checked;
    indicator.input.checked = indicatorSrc.checked;
    options.hidden = !on;
    group.classList.toggle('is-collapsed', !on);
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
  shuffle.input.addEventListener('change', () => { if (shuffleSrc) shuffleSrc.checked = shuffle.input.checked; });
  indicator.input.addEventListener('change', () => { indicatorSrc.checked = indicator.input.checked; });

  // Changes made on the Advanced tab
  autoSlideSrc.addEventListener('input', sync);
  loopSrc.addEventListener('change', sync);
  if (shuffleSrc) shuffleSrc.addEventListener('change', sync);
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

  const easing = resolveEasing(formState.form.querySelector('[name="config.autoAnimateEasing"]')?.value.trim() || 'ease');
  const seconds = Number(formState.form.querySelector('[name="config.autoAnimateDuration"]')?.value);
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
function buildEasingSelect(grid, selectMirrors) {
  const def = formState.schema.config?.fields?.autoAnimateEasing;
  const source = formState.form.querySelector('[name="config.autoAnimateEasing"]');
  if (!def || !source) return;

  const group = cloneTemplate('tpl-setup-select-group');
  const label = group.querySelector('[data-role="label"]');
  label.htmlFor = 'setup-autoAnimateEasing';
  label.textContent = t('Auto-Animate Easing');
  if (def.doc?.[lang]) label.title = def.doc[lang];

  const select = group.querySelector('[data-role="select"]');
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
      custom.textContent = tf('Custom: {value}', { value });
      custom.hidden = false;
      select.value = value;
    }
  };

  select.addEventListener('change', () => { source.value = select.value; playAutoAnimateDemo(); });
  source.addEventListener('input', sync);
  source.addEventListener('change', sync);

  grid.appendChild(group);

  const animateBtn = cloneTemplate('tpl-setup-animation-btn');
  animateBtn.addEventListener('click', playAutoAnimateDemo);
  grid.appendChild(animateBtn);

  selectMirrors.push({ select, source, sync });
  sync();
}

// Build the Setup tab (aspect/zoom sliders, preview, auto mode, selects), wired to the config inputs.
export function buildSetupTab(container) {
  const wrapper = cloneTemplate('tpl-setup-layout');
  const slot = (role) => wrapper.querySelector(`[data-role="${role}"]`);

  // Aspect ratio slider (stops/ticks come from ASPECT_STOPS)
  const aspectValue = slot('aspect-value');
  const aspectInput = slot('aspect');
  aspectInput.max = String(ASPECT_STOPS.length - 1);
  const aspectStops = slot('aspect-stops');
  const aspectTicks = slot('aspect-ticks');
  ASPECT_STOPS.forEach((stop, i) => {
    const option = document.createElement('option');
    option.value = String(i);
    aspectStops.appendChild(option);
    const tick = document.createElement('span');
    tick.textContent = stop.label;
    aspectTicks.appendChild(tick);
  });

  // Zoom slider. Slider value runs zoomed out (left) -> zoomed in (right),
  // so it is the inverse of the height it controls.
  const zoomValue = slot('zoom-value');
  const zoomInput = slot('zoom');
  zoomInput.max = String(ZOOM_SLIDER_STEPS);

  const autoMode = buildAutoModeControls();

  const selectMirrors = [];
  // One grid for both rows of dropdowns so the columns (and button widths) line up
  const selectRow = slot('select-grid');

  const addSelect = ({ name, label, field, demo }) => {
    const def = formState.schema.config?.fields?.[field];
    const source = formState.form.querySelector(`[name="${name}"]`);
    if (!def || !source) return;

    const group = cloneTemplate('tpl-setup-select-group');
    const selectLabel = group.querySelector('[data-role="label"]');
    selectLabel.htmlFor = `setup-${field}`;
    selectLabel.textContent = t(label);
    if (def.doc?.[lang]) selectLabel.title = def.doc[lang];

    const select = group.querySelector('[data-role="select"]');
    select.id = `setup-${field}`;
    def.options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = field === 'transition' ? transitionLabel(opt) : t(String(opt).charAt(0).toUpperCase() + String(opt).slice(1));
      select.appendChild(option);
    });
    select.value = source.value;

    select.addEventListener('change', () => { source.value = select.value; if (demo) playTransitionDemo(); });
    source.addEventListener('change', () => { select.value = source.value; if (demo) playTransitionDemo(); });

    selectRow.appendChild(group);
    selectMirrors.push({ select, source });
  };

  // Row 1: slide transition, speed, preview button
  SETUP_SELECTS.filter(entry => entry.row === 1).forEach(addSelect);

  const previewBtn = cloneTemplate('tpl-setup-transition-btn');
  previewBtn.addEventListener('click', playTransitionDemo);
  selectRow.appendChild(previewBtn);

  // Row 2: background transition, auto-animate easing, preview button
  SETUP_SELECTS.filter(entry => entry.row === 2).forEach(addSelect);
  buildEasingSelect(selectRow, selectMirrors);

  // Preview: two sample slides, each preview transition moves forward to the other one
  const previewWrap = slot('preview-wrap');
  const frame = slot('frame');
  const dims = slot('dims');
  const first = cloneTemplate('tpl-setup-stage-first');
  const second = cloneTemplate('tpl-setup-stage-second');
  frame.appendChild(first);
  frame.appendChild(second);
  const stages = [first, second];
  const slides = stages.map(stage => stage.querySelector('[data-role="slide"]'));
  if (autoMode) previewWrap.appendChild(autoMode.group);

  container.appendChild(wrapper);

  setupControls = { autoMode, selectMirrors, aspectInput, zoomInput, aspectValue, zoomValue, frame, stages, slides, currentStage: 0, finishTransition: null, dims };

  const getDimensionInputs = () => ({
    widthInput: formState.form.querySelector('[name="config.width"]'),
    heightInput: formState.form.querySelector('[name="config.height"]')
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

// Lightweight CSS imitation of the selected reveal.js transition. The two sample
// slides alternate: the one showing leaves while the other arrives.
function playTransitionDemo() {
  if (!setupControls || !setupControls.frame.animate) return;
  const state = setupControls;
  state.finishTransition?.(); // settle any transition still in flight

  const type = formState.form.querySelector('[name="config.transition"]')?.value;
  const speed = formState.form.querySelector('[name="config.transitionSpeed"]')?.value;
  const def = getTransition(type);
  const future = def?.future;

  const outgoing = state.stages[state.currentStage];
  const incoming = state.stages[1 - state.currentStage];

  const finish = () => {
    outgoing.getAnimations().concat(incoming.getAnimations()).forEach(a => a.cancel());
    outgoing.classList.add('setup-preview-stage-hidden');
    outgoing.style.zIndex = '';
    incoming.style.zIndex = '';
    outgoing.style.backfaceVisibility = '';
    state.currentStage = 1 - state.currentStage;
    state.finishTransition = null;
  };

  incoming.classList.remove('setup-preview-stage-hidden');
  if (!future) { // "none" switches instantly
    finish();
    return;
  }

  // The leaving slide normally sits under the arriving one; page turn flips that
  outgoing.style.zIndex = def.outgoingOnTop ? '2' : '1';
  incoming.style.zIndex = def.outgoingOnTop ? '1' : '2';
  const duration = (TRANSITION_DURATIONS[speed] || TRANSITION_DURATIONS.default) * (def.durationScale || 1);
  const timing = { duration, easing: def.easing || 'ease', fill: 'both' };
  const keyframes = demoKeyframes(def);
  Object.assign(outgoing.style, keyframes.staticOutgoing);
  // Sequential transitions: the old slide goes first and the new one follows, overlapping by `overlap`
  const overlap = def.overlap || 0;
  const phase = def.sequential ? duration * (1 + overlap) / 2 : duration;
  const delay = def.sequential ? duration * (1 - overlap) / 2 : 0;
  const inAnimation = incoming.animate(keyframes.incoming, { ...timing, duration: phase, delay });
  outgoing.animate(keyframes.outgoing, { ...timing, duration: phase });
  state.finishTransition = finish;
  inAnimation.onfinish = () => {
    if (state.finishTransition === finish) finish();
  };
}

// Derive config.maxScale / config.minScale from the slide size.
// maxScale: ceil(4K height / slide height) + 1 for headroom, never below MIN_MAX_SCALE.
// minScale: the scale at which the slide still fits a SMALL_WINDOW_WIDTH x SMALL_WINDOW_HEIGHT
//   window, floored to 0.01 and capped at MAX_MIN_SCALE.
function updateScaleLimits(width, height) {
  if (!(height > 0)) return;
  const maxScaleInput = formState.form.querySelector('[name="config.maxScale"]');
  if (maxScaleInput) {
    maxScaleInput.value = String(Math.max(MIN_MAX_SCALE, Math.ceil(UHD_SCREEN_HEIGHT / height) + 1));
  }

  const minScaleInput = formState.form.querySelector('[name="config.minScale"]');
  if (minScaleInput && width > 0) {
    const fit = Math.min(SMALL_WINDOW_WIDTH / width, SMALL_WINDOW_HEIGHT / height);
    const floored = Math.floor(fit * 100 + 1e-9) / 100;
    minScaleInput.value = String(Math.max(0.01, Math.min(MAX_MIN_SCALE, floored)));
  }
}

// Refresh the Setup tab controls and preview from the underlying config inputs (after load or edits).
export function syncSetupFromInputs() {
  if (!setupControls) return;
  setupControls.selectMirrors.forEach(({ select, source, sync }) => {
    if (sync) sync();
    else select.value = source.value;
  });
  setupControls.autoMode?.sync();
  const widthInput = formState.form.querySelector('[name="config.width"]');
  const heightInput = formState.form.querySelector('[name="config.height"]');
  const width = Number(widthInput?.value);
  const height = Number(heightInput?.value);
  if (!(width > 0) || !(height > 0)) return;

  const ratio = width / height;
  setupControls.aspectInput.value = String(aspectRatioToPosition(ratio));
  setupControls.zoomInput.value = String(zoomHeightToPosition(height));
  renderSetupPreview(width, height, ratio);
}

// Label for an aspect ratio: the matching named stop (e.g. 16:9) or "x.xx:1".
function describeAspect(ratio) {
  const stop = ASPECT_STOPS.find(s => Math.abs(s.ratio - ratio) < 0.005);
  return stop ? stop.label : `${ratio.toFixed(2)}:1`;
}

// Update the preview readouts and scale a real-size slide into the preview frame.
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
  frame.style.setProperty('--preview-frame-w', `${width * scale}px`);
  frame.style.setProperty('--preview-frame-h', `${height * scale}px`);
  slides.forEach(slide => {
    slide.style.setProperty('--preview-slide-w', `${width}px`);
    slide.style.setProperty('--preview-slide-h', `${height}px`);
    slide.style.setProperty('--preview-font-size', `${PREVIEW_BASE_FONT_PX}px`);
    slide.style.setProperty('--preview-scale', String(scale));
  });
}
