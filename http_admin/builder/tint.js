/*
 * Background tint menu and color utilities.
 *
 * Sections:
 * - Color parsing helpers
 * - Tint menu rendering
 */
import { trFormat, topEditorEl, state } from './context.js';
import { applyBgtintInsertToTopEditor, stripMacroLines } from './editor-actions.js';
import { markDirty } from './app-state.js';
import { schedulePreviewUpdate } from './preview.js';

// --- Color parsing helpers ---
// Clamp a numeric value into an inclusive range.
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Convert hex color (#rrggbb) to an RGB object.
function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return null;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r, g, b };
}

// Convert an RGB object to a hex color string.
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

const LINEAR_DIRECTIONS = [
  'to top',
  'to top right',
  'to right',
  'to bottom right',
  'to bottom',
  'to bottom left',
  'to left',
  'to top left'
];

const RADIAL_SHAPES = ['circle', 'ellipse'];

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

function cssColorToRgba(colorValue) {
  if (!colorValue || typeof colorValue !== 'string') {
    return null;
  }

  const probe = document.createElement('span');
  probe.style.color = '';
  probe.style.color = colorValue.trim();
  if (!probe.style.color) {
    return null;
  }

  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();

  const match = resolved.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)/i);
  if (!match) {
    return null;
  }

  const r = clamp(parseInt(match[1], 10), 0, 255);
  const g = clamp(parseInt(match[2], 10), 0, 255);
  const b = clamp(parseInt(match[3], 10), 0, 255);
  const a = clamp(parseFloat(match[4] ?? '1'), 0, 1);
  if ([r, g, b, a].some((value) => Number.isNaN(value))) {
    return null;
  }
  return { r, g, b, a };
}

function rgbaToStop(rgba, position = 0) {
  return {
    hex: rgbToHex(rgba),
    alpha: clamp(rgba.a, 0, 1),
    position: clamp(position, 0, 100)
  };
}

function extractBgtintValue() {
  const match = topEditorEl?.value.match(/\{\{bgtint:([^}]*)}}/i);
  if (!match) {
    return '';
  }
  return match[1].trim();
}

function assignDefaultPositions(stops) {
  if (!Array.isArray(stops) || !stops.length) {
    return [];
  }
  if (stops.length === 1) {
    return [{ ...stops[0], position: 0 }];
  }
  return stops.map((stop, index) => {
    const hasValidPosition = Number.isFinite(stop.position);
    if (hasValidPosition) {
      return { ...stop, position: formatPosition(stop.position) };
    }
    const percent = (index / (stops.length - 1)) * 100;
    return { ...stop, position: formatPosition(percent) };
  });
}

function parseGradientStop(part) {
  const trimmed = part.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(.*?)(?:\s+(-?\d+(?:\.\d+)?)\s*%)?$/);
  if (!match) {
    return null;
  }
  const colorPart = (match[1] || '').trim();
  if (!colorPart) {
    return null;
  }

  const rgba = cssColorToRgba(colorPart);
  if (!rgba) {
    return null;
  }

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

function parseExistingBgtintConfig() {
  const value = extractBgtintValue();
  const fallback = {
    gradientType: 'linear',
    linearDirection: 'to bottom',
    radialShape: 'circle',
    stops: [rgbaToStop({ r: 64, g: 95, b: 95, a: 0.6 }, 0)]
  };

  if (!value) {
    return fallback;
  }

  const linearMatch = value.match(/^linear-gradient\((.*)\)$/i);
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
      return {
        gradientType: 'linear',
        linearDirection: direction,
        radialShape: 'circle',
        stops: assignDefaultPositions(parsedStops)
      };
    }
  }

  const radialMatch = value.match(/^radial-gradient\((.*)\)$/i);
  if (radialMatch) {
    const parts = splitTopLevel(radialMatch[1]);
    let shape = 'circle';
    if (parts.length && !parseGradientStop(parts[0])) {
      const parsedShape = parseRadialShape(parts[0]);
      if (parsedShape) {
        shape = parsedShape;
      }
      parts.shift();
    }
    const parsedStops = parts.map(parseGradientStop).filter(Boolean);
    if (parsedStops.length >= 2) {
      return {
        gradientType: 'radial',
        linearDirection: 'to bottom',
        radialShape: shape,
        stops: assignDefaultPositions(parsedStops)
      };
    }
  }

  const rgba = cssColorToRgba(value);
  if (rgba) {
    return {
      gradientType: 'linear',
      linearDirection: 'to bottom',
      radialShape: 'circle',
      stops: [rgbaToStop(rgba, 0)]
    };
  }

  return fallback;
}

function stopToRgbaString(stop) {
  const rgb = hexToRgb(stop.hex) || { r: 64, g: 95, b: 95 };
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${formatAlpha(stop.alpha)})`;
}

function buildTintValue(stops, gradientType, linearDirection, radialShape) {
  if (!Array.isArray(stops) || !stops.length) {
    return 'rgba(64,95,95,0.60)';
  }

  if (stops.length === 1) {
    return stopToRgbaString(stops[0]);
  }

  const gradientStops = stops.map((stop) => `${stopToRgbaString(stop)} ${formatPosition(stop.position)}%`);
  if (gradientType === 'radial') {
    const shape = RADIAL_SHAPES.includes(radialShape) ? radialShape : 'circle';
    return `radial-gradient(${shape},${gradientStops.join(',')})`;
  }
  const direction = parseLinearDirection(linearDirection) || 'to bottom';
  return `linear-gradient(${direction},${gradientStops.join(',')})`;
}

// --- Tint menu rendering ---
// Render tint picker UI with live preview and insert/clear actions.
function renderTintMenu(menuEl, onClose) {
  if (!menuEl) return;
  menuEl.innerHTML = '';
  menuEl.onpointerdown = (event) => event.stopPropagation();
  menuEl.onclick = (event) => event.stopPropagation();

  const initialConfig = parseExistingBgtintConfig();
  const tintState = {
    stops: initialConfig.stops,
    gradientType: initialConfig.gradientType,
    linearDirection: initialConfig.linearDirection,
    radialShape: initialConfig.radialShape
  };

  const header = document.createElement('div');
  header.className = 'builder-tint-row';
  header.textContent = tr('Background tint');

  const gradientRow = document.createElement('div');
  gradientRow.className = 'builder-tint-row';
  const gradientLabel = document.createElement('span');
  gradientLabel.textContent = tr('Gradient Type');
  const gradientTypeSelect = document.createElement('select');
  [
    { value: 'linear', label: tr('Linear') },
    { value: 'radial', label: tr('Radial') }
  ].forEach((optionData) => {
    const option = document.createElement('option');
    option.value = optionData.value;
    option.textContent = optionData.label;
    gradientTypeSelect.appendChild(option);
  });
  gradientTypeSelect.value = tintState.gradientType;
  gradientRow.appendChild(gradientLabel);
  gradientRow.appendChild(gradientTypeSelect);

  const directionRow = document.createElement('div');
  directionRow.className = 'builder-tint-row';
  const directionLabel = document.createElement('span');
  directionLabel.textContent = tr('Direction');
  const directionSelect = document.createElement('select');
  LINEAR_DIRECTIONS.forEach((direction) => {
    const option = document.createElement('option');
    option.value = direction;
    option.textContent = direction;
    directionSelect.appendChild(option);
  });
  directionSelect.value = tintState.linearDirection;
  directionRow.appendChild(directionLabel);
  directionRow.appendChild(directionSelect);

  const shapeRow = document.createElement('div');
  shapeRow.className = 'builder-tint-row';
  const shapeLabel = document.createElement('span');
  shapeLabel.textContent = tr('Shape');
  const shapeSelect = document.createElement('select');
  RADIAL_SHAPES.forEach((shape) => {
    const option = document.createElement('option');
    option.value = shape;
    option.textContent = shape === 'circle' ? tr('Circle') : tr('Ellipse');
    shapeSelect.appendChild(option);
  });
  shapeSelect.value = tintState.radialShape;
  shapeRow.appendChild(shapeLabel);
  shapeRow.appendChild(shapeSelect);

  const toolbar = document.createElement('div');
  toolbar.className = 'builder-tint-actions';
  const addStopBtn = document.createElement('button');
  addStopBtn.type = 'button';
  addStopBtn.className = 'panel-button';
  addStopBtn.textContent = tr('Add Color Stop');
  toolbar.appendChild(addStopBtn);

  const stopList = document.createElement('div');
  stopList.className = 'builder-tint-stops';

  const preview = document.createElement('div');
  preview.className = 'builder-tint-preview';

  const actions = document.createElement('div');
  actions.className = 'builder-tint-actions';
  const insertBtn = document.createElement('button');
  insertBtn.type = 'button';
  insertBtn.className = 'panel-button';
  insertBtn.textContent = tr('Insert');
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'panel-button';
  clearBtn.textContent = tr('Clear');
  actions.appendChild(clearBtn);
  actions.appendChild(insertBtn);

  const updatePreview = () => {
    const tintValue = buildTintValue(tintState.stops, tintState.gradientType, tintState.linearDirection, tintState.radialShape);
    preview.style.background = tintValue;
    directionRow.style.display = tintState.gradientType === 'linear' ? '' : 'none';
    shapeRow.style.display = tintState.gradientType === 'radial' ? '' : 'none';
  };

  const renderStops = () => {
    stopList.innerHTML = '';
    tintState.stops.forEach((stop, index) => {
      const row = document.createElement('div');
      row.className = 'builder-tint-stop';

      const title = document.createElement('div');
      title.className = 'builder-tint-stop-title';
      title.textContent = trFormat('Stop {value}', { value: index + 1 });

      const colorLabel = document.createElement('label');
      colorLabel.className = 'builder-tint-field';
      const colorText = document.createElement('span');
      colorText.textContent = tr('Color');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = stop.hex;
      colorLabel.appendChild(colorText);
      colorLabel.appendChild(colorInput);

      const alphaLabel = document.createElement('label');
      alphaLabel.className = 'builder-tint-field';
      const alphaText = document.createElement('span');
      alphaText.textContent = trFormat('Alpha {value}', { value: formatAlpha(stop.alpha) });
      const alphaInput = document.createElement('input');
      alphaInput.type = 'range';
      alphaInput.min = '0';
      alphaInput.max = '1';
      alphaInput.step = '0.01';
      alphaInput.value = String(stop.alpha);
      alphaLabel.appendChild(alphaText);
      alphaLabel.appendChild(alphaInput);

      const positionLabel = document.createElement('label');
      positionLabel.className = 'builder-tint-field';
      const positionText = document.createElement('span');
      positionText.textContent = tr('Position %');
      const positionInput = document.createElement('input');
      positionInput.type = 'number';
      positionInput.min = '0';
      positionInput.max = '100';
      positionInput.step = '0.1';
      positionInput.value = String(formatPosition(stop.position));
      positionLabel.appendChild(positionText);
      positionLabel.appendChild(positionInput);

      const buttons = document.createElement('div');
      buttons.className = 'builder-tint-stop-buttons';
      const duplicateBtn = document.createElement('button');
      duplicateBtn.type = 'button';
      duplicateBtn.className = 'panel-button';
      duplicateBtn.textContent = tr('Duplicate');
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'panel-button';
      deleteBtn.textContent = tr('Delete');
      deleteBtn.disabled = tintState.stops.length <= 1;
      buttons.appendChild(duplicateBtn);
      buttons.appendChild(deleteBtn);

      colorInput.addEventListener('input', () => {
        tintState.stops[index].hex = colorInput.value;
        updatePreview();
      });

      alphaInput.addEventListener('input', () => {
        const alpha = clamp(parseFloat(alphaInput.value), 0, 1);
        tintState.stops[index].alpha = alpha;
        alphaText.textContent = trFormat('Alpha {value}', { value: formatAlpha(alpha) });
        updatePreview();
      });

      positionInput.addEventListener('input', () => {
        const position = formatPosition(parseFloat(positionInput.value || '0'));
        tintState.stops[index].position = position;
        updatePreview();
      });

      duplicateBtn.addEventListener('click', () => {
        if (tintState.stops.length === 1) {
          const first = { ...tintState.stops[0], position: 0 };
          const second = { ...tintState.stops[0], position: 100 };
          tintState.stops = [first, second];
        } else {
          const current = tintState.stops[index];
          const next = tintState.stops[index + 1];
          const newPosition = next
            ? formatPosition((current.position + next.position) / 2)
            : formatPosition(Math.min(current.position + 10, 100));
          tintState.stops.splice(index + 1, 0, { ...current, position: newPosition });
        }
        renderStops();
        updatePreview();
      });

      deleteBtn.addEventListener('click', () => {
        if (tintState.stops.length <= 1) {
          return;
        }
        tintState.stops.splice(index, 1);
        if (tintState.stops.length === 1) {
          tintState.stops[0].position = 0;
        }
        renderStops();
        updatePreview();
      });

      row.appendChild(title);
      row.appendChild(colorLabel);
      row.appendChild(alphaLabel);
      row.appendChild(positionLabel);
      row.appendChild(buttons);
      stopList.appendChild(row);
    });
  };

  addStopBtn.addEventListener('click', () => {
    if (tintState.stops.length === 0) {
      tintState.stops.push(rgbaToStop({ r: 64, g: 95, b: 95, a: 0.6 }, 0));
    } else if (tintState.stops.length === 1) {
      const stop = tintState.stops[0];
      tintState.stops = [
        { ...stop, position: 0 },
        { ...stop, position: 100 }
      ];
    } else {
      const last = tintState.stops[tintState.stops.length - 1];
      tintState.stops.push({
        ...last,
        position: formatPosition(Math.min(last.position + 10, 100))
      });
    }
    renderStops();
    updatePreview();
  });

  gradientTypeSelect.addEventListener('change', () => {
    tintState.gradientType = gradientTypeSelect.value === 'radial' ? 'radial' : 'linear';
    updatePreview();
  });

  directionSelect.addEventListener('change', () => {
    tintState.linearDirection = parseLinearDirection(directionSelect.value) || 'to bottom';
    updatePreview();
  });

  shapeSelect.addEventListener('change', () => {
    tintState.radialShape = RADIAL_SHAPES.includes(shapeSelect.value) ? shapeSelect.value : 'circle';
    updatePreview();
  });

  renderStops();
  updatePreview();

  insertBtn.addEventListener('click', () => {
    if (onClose) onClose();
    applyBgtintInsertToTopEditor(buildTintValue(tintState.stops, tintState.gradientType, tintState.linearDirection, tintState.radialShape));
  });

  clearBtn.addEventListener('click', () => {
    if (onClose) onClose();
    const cleaned = stripMacroLines(
      topEditorEl.value,
      topEditorEl.selectionStart,
      topEditorEl.selectionEnd,
      ['{{bgtint']
    );
    if (cleaned.text !== topEditorEl.value) {
      topEditorEl.value = cleaned.text;
      topEditorEl.selectionStart = cleaned.selectionStart;
      topEditorEl.selectionEnd = cleaned.selectionEnd;
      const { h, v } = state.selected;
      state.stacks[h][v].top = topEditorEl.value;
      markDirty();
      schedulePreviewUpdate();
    }
  });

  menuEl.appendChild(header);
  menuEl.appendChild(gradientRow);
  menuEl.appendChild(directionRow);
  menuEl.appendChild(shapeRow);
  menuEl.appendChild(toolbar);
  menuEl.appendChild(stopList);
  menuEl.appendChild(preview);
  menuEl.appendChild(actions);
}

export { renderTintMenu };
