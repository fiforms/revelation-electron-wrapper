/*
 * Gradient / colour picker shared by the builder's Background Tint menu (builder/tint.js) and the Style tab
 * of Presentation Properties (create/tab-style.js).
 *
 * Model (pure, import-safe in Node; tests/gradientPicker.test.js):
 *   parseGradient(value, fallbackColor?) -> { gradientType, linearDirection, radialShape, stops }
 *   tryParseGradient(value)              -> the same, or null when the value is not a colour or gradient (use this
 *                                           to validate text that will be written into CSS)
 *   buildGradient(config, { alpha })     -> CSS value: rgba()/#rrggbb for one stop, else linear-/radial-gradient(...)
 *                                           alpha: true (default) rgba() stops, false #rrggbb stops, 'auto' #rrggbb
 *                                           for opaque stops and rgba() only where alpha < 1
 *   cssColorToRgba(value)                -> { r, g, b, a } | null  (hex and rgb()/rgba() without a DOM; named colours
 *                                           and hsl() through a throwaway element when a document exists)
 * A stop is { hex: '#rrggbb', alpha: 0..1, position: 0..100 }.
 *
 * Widget:
 *   mountGradientPicker(container, { value, alpha, gradient, translate, onChange }) -> { getValue(), setValue(v), destroy() }
 *   Draws the type/direction/shape selects, the stop cards (colour, alpha, position, duplicate, delete) and a live
 *   preview strip. It knows nothing about editors or macros: it reports every change through onChange(cssValue)
 *   and the caller does the inserting. setValue() redraws without calling onChange.
 *   alpha: true (default) shows an alpha slider per stop and writes rgba(); false hides it, forces every stop to
 *   fully opaque and writes #rrggbb. Use false where transparency is meaningless (e.g. the base slide background).
 *   gradient: true (default) offers linear/radial gradients with any number of stops; false is a single-colour
 *   picker (one stop, no type/direction/shape/stop buttons; a gradient passed in is cut down to its first stop).
 *   translate(key): defaults to window.tr when present, else the key. Keys are already in the admin
 *   translations.json ("Gradient Type", "Stop {value}", ...); {placeholders} are filled here.
 *
 * The widget's stylesheet (gradient-picker.css, next to this file) is added to <head> on first mount, so a page
 * needs no <link>. Existing builder output ({{bgtint:...}}) is unchanged: same rgba(r,g,b,0.60) / "stop 12.5%" format.
 */

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hexToRgb(hex) {
  const normalized = String(hex || '').replace('#', '');
  if (normalized.length !== 6) return null;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r, g, b };
}

function rgbToHex({ r, g, b }) {
  const toHex = (value) => value.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatAlpha(value) {
  return roundTo(clamp(value, 0, 1), 2).toFixed(2);
}

function formatPosition(value) {
  return roundTo(clamp(value, 0, 100), 1);
}

export const LINEAR_DIRECTIONS = [
  'to top',
  'to top right',
  'to right',
  'to bottom right',
  'to bottom',
  'to bottom left',
  'to left',
  'to top left'
];

export const RADIAL_SHAPES = ['circle', 'ellipse'];

const DEFAULT_COLOR = { r: 64, g: 95, b: 95, a: 0.6 };

// Split on a delimiter that is not inside parentheses, so rgba(1,2,3,.5) stays one piece.
function splitTopLevel(input, delimiter = ',') {
  const parts = [];
  let current = '';
  let depth = 0;

  for (const ch of input) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === delimiter && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

// Parse #rgb, #rrggbb, #rrggbbaa and comma-form rgb()/rgba() without a DOM.
function parseSimpleColor(value) {
  const text = value.trim();
  let m = text.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (m) {
    let hex = m[1];
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a };
  }
  m = text.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/i);
  if (m) {
    const a = clamp(parseFloat(m[4] ?? '1'), 0, 1);
    if (Number.isNaN(a)) return null;
    return { r: clamp(+m[1], 0, 255), g: clamp(+m[2], 0, 255), b: clamp(+m[3], 0, 255), a };
  }
  return null;
}

// Any CSS colour to { r, g, b, a }, or null. Hex and rgb() need no DOM; names and hsl() use a probe element.
export function cssColorToRgba(colorValue) {
  if (!colorValue || typeof colorValue !== 'string') return null;
  const simple = parseSimpleColor(colorValue);
  if (simple) return simple;
  if (typeof document === 'undefined' || !document.body) return null;

  const probe = document.createElement('span');
  probe.style.color = '';
  probe.style.color = colorValue.trim();
  if (!probe.style.color) return null;

  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return parseSimpleColor(resolved);
}

function rgbaToStop(rgba, position = 0) {
  return {
    hex: rgbToHex(rgba),
    alpha: clamp(rgba.a, 0, 1),
    position: clamp(position, 0, 100)
  };
}

function assignDefaultPositions(stops) {
  if (!Array.isArray(stops) || !stops.length) return [];
  if (stops.length === 1) return [{ ...stops[0], position: 0 }];
  return stops.map((stop, index) => {
    if (Number.isFinite(stop.position)) return { ...stop, position: formatPosition(stop.position) };
    return { ...stop, position: formatPosition((index / (stops.length - 1)) * 100) };
  });
}

function parseGradientStop(part) {
  const trimmed = part.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(.*?)(?:\s+(-?\d+(?:\.\d+)?)\s*%)?$/);
  if (!match) return null;
  const colorPart = (match[1] || '').trim();
  if (!colorPart) return null;
  const rgba = cssColorToRgba(colorPart);
  if (!rgba) return null;
  const pos = match[2] == null ? NaN : parseFloat(match[2]);
  return rgbaToStop(rgba, Number.isFinite(pos) ? pos : NaN);
}

function parseLinearDirection(part) {
  const normalized = String(part || '').trim().toLowerCase();
  return LINEAR_DIRECTIONS.includes(normalized) ? normalized : null;
}

function parseRadialShape(part) {
  const normalized = String(part || '').trim().toLowerCase();
  if (normalized.includes('ellipse')) return 'ellipse';
  if (normalized.includes('circle')) return 'circle';
  return null;
}

// Read a CSS colour or linear-/radial-gradient string into editor state, or null when it is not one.
export function tryParseGradient(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const linearMatch = text.match(/^linear-gradient\((.*)\)$/i);
  if (linearMatch) {
    const parts = splitTopLevel(linearMatch[1]);
    let direction = 'to bottom';
    if (parts.length) {
      const parsedDirection = parseLinearDirection(parts[0]);
      if (parsedDirection) {
        direction = parsedDirection;
        parts.shift();
      }
    }
    const parsedStops = parts.map(parseGradientStop).filter(Boolean);
    if (parsedStops.length >= 2) {
      return { gradientType: 'linear', linearDirection: direction, radialShape: 'circle', stops: assignDefaultPositions(parsedStops) };
    }
  }

  const radialMatch = text.match(/^radial-gradient\((.*)\)$/i);
  if (radialMatch) {
    const parts = splitTopLevel(radialMatch[1]);
    let shape = 'circle';
    if (parts.length && !parseGradientStop(parts[0])) {
      const parsedShape = parseRadialShape(parts[0]);
      if (parsedShape) shape = parsedShape;
      parts.shift();
    }
    const parsedStops = parts.map(parseGradientStop).filter(Boolean);
    if (parsedStops.length >= 2) {
      return { gradientType: 'radial', linearDirection: 'to bottom', radialShape: shape, stops: assignDefaultPositions(parsedStops) };
    }
  }

  const rgba = cssColorToRgba(text);
  if (rgba) {
    return { gradientType: 'linear', linearDirection: 'to bottom', radialShape: 'circle', stops: [rgbaToStop(rgba, 0)] };
  }
  return null;
}

// Like tryParseGradient, but anything that is not understood (including an empty string) gives a single
// stop of `fallbackColor`, so an editor always has something to show.
export function parseGradient(value, fallbackColor = DEFAULT_COLOR) {
  return tryParseGradient(value) || {
    gradientType: 'linear',
    linearDirection: 'to bottom',
    radialShape: 'circle',
    stops: [rgbaToStop(fallbackColor, 0)]
  };
}

function stopToString(stop, alpha) {
  const rgb = hexToRgb(stop.hex) || DEFAULT_COLOR;
  if (!alpha || (alpha === 'auto' && clamp(stop.alpha, 0, 1) >= 1)) return rgbToHex(rgb);
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${formatAlpha(stop.alpha)})`;
}

// Build the CSS value for an editor state. alpha:false writes #rrggbb stops and ignores each stop's alpha.
export function buildGradient(config, { alpha = true } = {}) {
  const stops = config && Array.isArray(config.stops) ? config.stops : [];
  if (!stops.length) return alpha ? 'rgba(64,95,95,0.60)' : '#405f5f';
  if (stops.length === 1) return stopToString(stops[0], alpha);

  const gradientStops = stops.map((stop) => `${stopToString(stop, alpha)} ${formatPosition(stop.position)}%`);
  if (config.gradientType === 'radial') {
    const shape = RADIAL_SHAPES.includes(config.radialShape) ? config.radialShape : 'circle';
    return `radial-gradient(${shape},${gradientStops.join(',')})`;
  }
  const direction = parseLinearDirection(config.linearDirection) || 'to bottom';
  return `linear-gradient(${direction},${gradientStops.join(',')})`;
}

// --- Widget ---

function ensureStylesheet() {
  if (typeof document === 'undefined' || document.querySelector('link[data-gradient-picker-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./gradient-picker.css', import.meta.url).href;
  link.setAttribute('data-gradient-picker-css', '');
  document.head.appendChild(link);
}

function defaultTranslate(key) {
  return typeof window !== 'undefined' && typeof window.tr === 'function' ? window.tr(key) : key;
}

// Small DOM helper: element with class and optional text.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function mountGradientPicker(container, options = {}) {
  const { value = '', alpha = true, gradient = true, onChange = null } = options;
  const tr = options.translate || defaultTranslate;
  const trFormat = (key, vars) => tr(key).replace(/\{(\w+)\}/g, (m, token) => (token in vars ? vars[token] : m));
  ensureStylesheet();

  const normalize = (config) => {
    if (!gradient) {
      config.stops = config.stops.slice(0, 1);
      config.stops[0].position = 0;
    }
    if (!alpha) config.stops.forEach((stop) => { stop.alpha = 1; });
    return config;
  };
  let config = normalize(parseGradient(value));

  const root = el('div', 'gradient-picker');

  const gradientRow = el('div', 'gp-row');
  gradientRow.appendChild(el('span', '', tr('Gradient Type')));
  const gradientTypeSelect = el('select');
  [{ value: 'linear', label: tr('Linear') }, { value: 'radial', label: tr('Radial') }].forEach((opt) => {
    const option = el('option', '', opt.label);
    option.value = opt.value;
    gradientTypeSelect.appendChild(option);
  });
  gradientRow.appendChild(gradientTypeSelect);

  const directionRow = el('div', 'gp-row');
  directionRow.appendChild(el('span', '', tr('Direction')));
  const directionSelect = el('select');
  LINEAR_DIRECTIONS.forEach((direction) => {
    const option = el('option', '', direction);
    option.value = direction;
    directionSelect.appendChild(option);
  });
  directionRow.appendChild(directionSelect);

  const shapeRow = el('div', 'gp-row');
  shapeRow.appendChild(el('span', '', tr('Shape')));
  const shapeSelect = el('select');
  RADIAL_SHAPES.forEach((shape) => {
    const option = el('option', '', shape === 'circle' ? tr('Circle') : tr('Ellipse'));
    option.value = shape;
    shapeSelect.appendChild(option);
  });
  shapeRow.appendChild(shapeSelect);

  const toolbar = el('div', 'gp-actions');
  const addStopBtn = el('button', 'gp-button', tr('Add Color Stop'));
  addStopBtn.type = 'button';
  toolbar.appendChild(addStopBtn);

  const stopList = el('div', 'gp-stops');
  const preview = el('div', 'gp-preview');

  const currentValue = () => buildGradient(config, { alpha });

  const syncControls = () => {
    gradientTypeSelect.value = config.gradientType;
    directionSelect.value = config.linearDirection;
    shapeSelect.value = config.radialShape;
    preview.style.background = currentValue();
    directionRow.style.display = config.gradientType === 'linear' ? '' : 'none';
    shapeRow.style.display = config.gradientType === 'radial' ? '' : 'none';
  };

  const changed = () => {
    syncControls();
    if (onChange) onChange(currentValue());
  };

  const renderStops = () => {
    stopList.innerHTML = '';
    config.stops.forEach((stop, index) => {
      const row = el('div', 'gp-stop');
      if (gradient) row.appendChild(el('div', 'gp-stop-title', trFormat('Stop {value}', { value: index + 1 })));

      const colorLabel = el('label', 'gp-field');
      colorLabel.appendChild(el('span', '', tr('Color')));
      const colorInput = el('input');
      colorInput.type = 'color';
      colorInput.value = stop.hex;
      colorLabel.appendChild(colorInput);
      row.appendChild(colorLabel);

      if (alpha) {
        const alphaLabel = el('label', 'gp-field');
        const alphaText = el('span', '', trFormat('Alpha {value}', { value: formatAlpha(stop.alpha) }));
        const alphaInput = el('input');
        alphaInput.type = 'range';
        alphaInput.min = '0';
        alphaInput.max = '1';
        alphaInput.step = '0.01';
        alphaInput.value = String(stop.alpha);
        alphaLabel.appendChild(alphaText);
        alphaLabel.appendChild(alphaInput);
        row.appendChild(alphaLabel);
        alphaInput.addEventListener('input', () => {
          const next = clamp(parseFloat(alphaInput.value), 0, 1);
          config.stops[index].alpha = next;
          alphaText.textContent = trFormat('Alpha {value}', { value: formatAlpha(next) });
          changed();
        });
      }

      const positionLabel = el('label', 'gp-field');
      positionLabel.appendChild(el('span', '', tr('Position %')));
      const positionInput = el('input');
      positionInput.type = 'number';
      positionInput.min = '0';
      positionInput.max = '100';
      positionInput.step = '0.1';
      positionInput.value = String(formatPosition(stop.position));
      positionLabel.appendChild(positionInput);
      if (gradient) row.appendChild(positionLabel);

      const buttons = el('div', 'gp-stop-buttons');
      const duplicateBtn = el('button', 'gp-button', tr('Duplicate'));
      duplicateBtn.type = 'button';
      const deleteBtn = el('button', 'gp-button', tr('Delete'));
      deleteBtn.type = 'button';
      deleteBtn.disabled = config.stops.length <= 1;
      buttons.appendChild(duplicateBtn);
      buttons.appendChild(deleteBtn);
      if (gradient) row.appendChild(buttons);

      colorInput.addEventListener('input', () => {
        config.stops[index].hex = colorInput.value;
        changed();
      });

      positionInput.addEventListener('input', () => {
        config.stops[index].position = formatPosition(parseFloat(positionInput.value || '0'));
        changed();
      });

      duplicateBtn.addEventListener('click', () => {
        if (config.stops.length === 1) {
          config.stops = [{ ...config.stops[0], position: 0 }, { ...config.stops[0], position: 100 }];
        } else {
          const current = config.stops[index];
          const next = config.stops[index + 1];
          const newPosition = next
            ? formatPosition((current.position + next.position) / 2)
            : formatPosition(Math.min(current.position + 10, 100));
          config.stops.splice(index + 1, 0, { ...current, position: newPosition });
        }
        renderStops();
        changed();
      });

      deleteBtn.addEventListener('click', () => {
        if (config.stops.length <= 1) return;
        config.stops.splice(index, 1);
        if (config.stops.length === 1) config.stops[0].position = 0;
        renderStops();
        changed();
      });

      stopList.appendChild(row);
    });
  };

  addStopBtn.addEventListener('click', () => {
    if (config.stops.length === 0) {
      config.stops.push(rgbaToStop(DEFAULT_COLOR, 0));
    } else if (config.stops.length === 1) {
      const stop = config.stops[0];
      config.stops = [{ ...stop, position: 0 }, { ...stop, position: 100 }];
    } else {
      const last = config.stops[config.stops.length - 1];
      config.stops.push({ ...last, position: formatPosition(Math.min(last.position + 10, 100)) });
    }
    renderStops();
    changed();
  });

  gradientTypeSelect.addEventListener('change', () => {
    config.gradientType = gradientTypeSelect.value === 'radial' ? 'radial' : 'linear';
    changed();
  });
  directionSelect.addEventListener('change', () => {
    config.linearDirection = parseLinearDirection(directionSelect.value) || 'to bottom';
    changed();
  });
  shapeSelect.addEventListener('change', () => {
    config.radialShape = RADIAL_SHAPES.includes(shapeSelect.value) ? shapeSelect.value : 'circle';
    changed();
  });

  renderStops();
  syncControls();

  if (gradient) root.append(gradientRow, directionRow, shapeRow, toolbar);
  root.append(stopList, preview);
  container.appendChild(root);

  return {
    getValue: currentValue,
    setValue(next) {
      config = normalize(parseGradient(next));
      renderStops();
      syncControls();
    },
    destroy() {
      root.remove();
    }
  };
}
