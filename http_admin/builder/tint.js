/*
 * Background tint menu (the 🎨 button in the slide toolbar).
 *
 * The gradient/colour editor itself is the shared widget in ../shared/gradient-picker.js. This file is the
 * builder-side adapter: it reads the current `{{bgtint:...}}` macro value from the top-matter editor, shows the
 * picker with a header and Clear/Insert buttons, and writes the result back through editor-actions.js. The macro
 * value is an rgba colour or a linear/radial gradient of rgba stops, so alpha stays enabled.
 *
 * Called by media.js (openTintMenu -> renderTintMenu).
 */
import { topEditorEl, state } from './context.js';
import { applyBgtintInsertToTopEditor, stripMacroLines } from './editor-actions.js';
import { markDirty } from './app-state.js';
import { schedulePreviewUpdate } from './preview.js';
import { mountGradientPicker } from '../shared/gradient-picker.js';

// The value of the {{bgtint:...}} macro in the top-matter editor, or '' when there is none.
function extractBgtintValue() {
  const match = topEditorEl?.value.match(/\{\{bgtint:([^}]*)}}/i);
  return match ? match[1].trim() : '';
}

// Render tint picker UI with live preview and insert/clear actions.
function renderTintMenu(menuEl, onClose) {
  if (!menuEl) return;
  menuEl.innerHTML = '';
  menuEl.onpointerdown = (event) => event.stopPropagation();
  menuEl.onclick = (event) => event.stopPropagation();

  const header = document.createElement('div');
  header.className = 'builder-tint-row';
  header.textContent = tr('Background tint');

  const pickerHost = document.createElement('div');
  const picker = mountGradientPicker(pickerHost, {
    value: extractBgtintValue(),
    alpha: true,
    translate: tr
  });

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

  insertBtn.addEventListener('click', () => {
    if (onClose) onClose();
    applyBgtintInsertToTopEditor(picker.getValue());
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
  menuEl.appendChild(pickerHost);
  menuEl.appendChild(actions);
}

export { renderTintMenu };
