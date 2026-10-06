/*
 * Macros tab of the Create / Edit Metadata form: tile editor for the `macros` front-matter map.
 *
 * Keeps the data as JSON in the hidden textarea #macros-json (name="macros", submitted by
 * create.js submitForm). renderMacroTiles() redraws #macros-container; openMacroEditModal and
 * deleteMacroItem rewrite the JSON and mark the form dirty. RESERVED_MACRO_NAMES lists the
 * built-in macro names users may not redefine.
 *
 * Markup (field chrome, tile, edit modal) comes from the tpl-macro(s)-* templates in
 * create/templates.html via cloneTemplate(); this file only fills in data and wires handlers.
 *
 * Callers: create.js (createMacros, and renderMacroTiles after loading metadata) and
 * tab-imports.js (renderMacroTiles).
 * Gotchas: macro names cannot be changed once created (read-only field in the edit modal).
 */
import { lang, t, tf, markDirty, cloneTemplate } from './metadata-form-core.js';

// --- Macros tile-based editor ---
export const RESERVED_MACRO_NAMES = new Set([
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

// Build the Macros field chrome (label and add button); tiles are drawn by renderMacroTiles().
export function createMacros(field) {
  const wrapper = cloneTemplate('tpl-macros-field');
  wrapper.querySelector('[data-role="label"]').textContent = field.label && field.label[lang] ? field.label[lang] : t('Macros');
  wrapper.querySelector('[data-role="add"]').onclick = () => openMacroEditModal(null);
  return wrapper;
}

// Redraw #macros-container tiles from the JSON in #macros-json.
export function renderMacroTiles() {
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
    const tile = cloneTemplate('tpl-macro-tile');
    tile.querySelector('[data-role="name"]').textContent = `{{${name}}}`;
    tile.querySelector('[data-role="code"]').textContent = String(code || '').substring(0, 150) + (String(code || '').length > 150 ? '…' : '');
    tile.querySelector('[data-role="edit"]').onclick = () => openMacroEditModal(name);
    tile.querySelector('[data-role="delete"]').onclick = () => deleteMacroItem(name);
    container.appendChild(tile);
  }
}

// Open the add/edit macro modal (name null = new); saving rewrites #macros-json and redraws tiles.
export function openMacroEditModal(macroName) {
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

  const overlay = cloneTemplate('tpl-macro-modal');
  const $ = (role) => overlay.querySelector(`[data-role="${role}"]`);

  $('title').textContent = macroName ? tf('Edit Macro: {name}', { name: `{{${macroName}}}` }) : t('Add New Macro');
  $('close').onclick = () => {
    overlay.remove();
  };

  const nameInput = $('name');
  nameInput.value = macroName || '';
  if (macroName) {
    nameInput.readOnly = true;
    nameInput.title = t('Macro name cannot be changed after creation.');
  }

  // Reserved names warning (the text is static; the tooltip lists the names)
  $('reserved').title = tf('Reserved macro names: {names}', { names: Array.from(RESERVED_MACRO_NAMES).sort().join(', ') });

  $('help-link').addEventListener('click', (e) => {
    if (window.electronAPI?.openHandoutView) {
      window.electronAPI.openHandoutView('readme', 'revelation-doc-authoring_reference.md');
      e.preventDefault();
    }
  });

  const codeInput = $('code');
  codeInput.value = currentCode;
  codeInput.placeholder = t('Enter the macro code/value here.\nExample: {{darkbg}} or {{transition:fade}}');

  const previewBox = $('preview');
  previewBox.textContent = `{{${nameInput.value || 'macroname'}}}`;

  // Update preview on name change
  const updatePreview = () => {
    previewBox.textContent = `{{${nameInput.value || 'macroname'}}}`;
  };
  nameInput.addEventListener('input', updatePreview);

  $('cancel').onclick = () => {
    overlay.remove();
  };

  $('save').onclick = () => {
    const newName = nameInput.value.trim();
    const newCode = codeInput.value.trim();

    if (!newName) {
      alert(t('Macro name is required'));
      return;
    }

    // Validate macro name format (alphanumeric and underscore/hyphen only)
    if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
      alert(t('Macro name can only contain letters, numbers, underscores, and hyphens'));
      nameInput.focus();
      return;
    }

    // Check for reserved macro names
    if (RESERVED_MACRO_NAMES.has(newName.toLowerCase())) {
      alert(`${tf('"{name}" is a reserved macro name. Please choose a different name.', { name: newName })}\n\n${tf('Reserved names: {names}', { names: Array.from(RESERVED_MACRO_NAMES).sort().join(', ') })}`);
      nameInput.focus();
      return;
    }

    if (!newCode) {
      alert(t('Macro code/value is required'));
      return;
    }

    // Check for duplicate name (only if creating new)
    if (!macroName && macrosData[newName]) {
      alert(tf('A macro named "{name}" already exists', { name: newName }));
      return;
    }

    // If editing and name changed, delete old key
    if (macroName && newName !== macroName) {
      delete macrosData[macroName];
    }

    macrosData[newName] = newCode;
    document.getElementById('macros-json').value = JSON.stringify(macrosData, null, 2);
    markDirty();

    overlay.remove();
    renderMacroTiles();
  };

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

// Confirm, then remove a macro from #macros-json and redraw the tiles.
export function deleteMacroItem(macroName) {
  if (!confirm(tf('Delete macro "{name}"?', { name: `{{${macroName}}}` }))) {
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
  markDirty();
  renderMacroTiles();
}
