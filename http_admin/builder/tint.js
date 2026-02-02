/*
 * Background tint menu and color utilities.
 *
 * Sections:
 * - Color parsing helpers
 * - Tint menu rendering
 */
import { tr, trFormat, topEditorEl, state } from './context.js';
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

// Parse existing {{bgtint:rgba(...)}} macro from top matter.
function parseExistingBgtint() {
  const match = topEditorEl?.value.match(/{{bgtint:rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([0-9.]+)\s*\)\s*}}/i);
  if (!match) return null;
  const r = clamp(parseInt(match[1], 10), 0, 255);
  const g = clamp(parseInt(match[2], 10), 0, 255);
  const b = clamp(parseInt(match[3], 10), 0, 255);
  const a = clamp(parseFloat(match[4]), 0, 1);
  if ([r, g, b, a].some((value) => Number.isNaN(value))) return null;
  return { r, g, b, a };
}

// --- Tint menu rendering ---
// Render tint picker UI with live preview and insert/clear actions.
function renderTintMenu(menuEl, onClose) {
  if (!menuEl) return;
  menuEl.innerHTML = '';

  const existing = parseExistingBgtint();
  const initialColor = existing ? rgbToHex(existing) : '#405f5f';
  const initialAlpha = existing ? existing.a : 0.6;

  const header = document.createElement('div');
  header.className = 'builder-tint-row';
  header.textContent = tr('Background tint');

  const colorRow = document.createElement('div');
  colorRow.className = 'builder-tint-row';
  const colorLabel = document.createElement('span');
  colorLabel.textContent = tr('Color');
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = initialColor;
  colorRow.appendChild(colorLabel);
  colorRow.appendChild(colorInput);

  const alphaRow = document.createElement('div');
  alphaRow.className = 'builder-tint-row';
  const alphaLabel = document.createElement('span');
  alphaLabel.textContent = trFormat('Alpha {value}', { value: initialAlpha.toFixed(2) });
  const alphaInput = document.createElement('input');
  alphaInput.type = 'range';
  alphaInput.min = '0';
  alphaInput.max = '1';
  alphaInput.step = '0.05';
  alphaInput.value = initialAlpha.toString();
  alphaRow.appendChild(alphaLabel);
  alphaRow.appendChild(alphaInput);

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
    const rgb = hexToRgb(colorInput.value) || { r: 64, g: 96, b: 96 };
    const alpha = clamp(parseFloat(alphaInput.value), 0, 1);
    alphaLabel.textContent = trFormat('Alpha {value}', { value: alpha.toFixed(2) });
    preview.style.background = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  };

  colorInput.addEventListener('input', updatePreview);
  alphaInput.addEventListener('input', updatePreview);
  updatePreview();

  insertBtn.addEventListener('click', () => {
    if (onClose) onClose();
    const rgb = hexToRgb(colorInput.value) || { r: 64, g: 96, b: 96 };
    const alpha = clamp(parseFloat(alphaInput.value), 0, 1);
    applyBgtintInsertToTopEditor(`rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`);
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
  menuEl.appendChild(colorRow);
  menuEl.appendChild(alphaRow);
  menuEl.appendChild(preview);
  menuEl.appendChild(actions);
}

export { renderTintMenu };
