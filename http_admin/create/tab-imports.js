/*
 * Imports tab of the Create / Edit Metadata form: link to a shared macros/media YAML file.
 *
 * createImports() clones tpl-imports-field (create/templates.html) and wires the path input
 * (#imports-input, name="imports") and the Browse, Save Current, Import, Edit and Clear buttons. Save Current moves the inline macros + media into a
 * file (electronAPI.saveMacrosToFile) and clears the inline copies; Import loads them back
 * (electronAPI.loadMacrosFromFile). Edit opens the file in the external editor.
 *
 * Callers: create.js buildFormWithTabs(). Uses renderMacroTiles/renderMediaTiles to refresh the
 * other tabs after Save/Import.
 * Gotchas: selectMacroFileDialog, openMacroFileInEditor, saveMacroSetToFile and
 * importMacroSetFromFile are leftovers of the older macros-only external file flow; nothing
 * calls them now (kept as-is, behavior-preserving split).
 */
import { formState, t, tf, lang, markDirty, cloneTemplate } from './metadata-form-core.js';
import { renderMediaTiles } from './tab-media.js';
import { renderMacroTiles } from './tab-macros.js';

// Build the Imports field (path input plus Browse/Save/Import/Edit/Clear buttons) and wire it up.
export function createImports(field) {
  const wrapper = cloneTemplate('tpl-imports-field');
  wrapper.querySelector('[data-role="label"]').textContent = field.label && field.label[lang] ? field.label[lang] : t('Imports');

  const importsInput = wrapper.querySelector('[data-role="input"]');
  wrapper.querySelector('[data-role="browse"]').onclick = () => selectImportsFileDialog(importsInput);
  wrapper.querySelector('[data-role="save"]').onclick = () => saveResourcesToFile(importsInput);
  wrapper.querySelector('[data-role="import"]').onclick = () => importResourcesFromFile(importsInput);
  wrapper.querySelector('[data-role="edit"]').onclick = () => openImportsFileInEditor(importsInput.value);
  wrapper.querySelector('[data-role="clear"]').onclick = () => {
    importsInput.value = '';
    updateImportsUI();
    importsInput.dispatchEvent(new Event('change', { bubbles: true }));
  };

  function updateImportsUI() {
    const hasFile = importsInput.value && importsInput.value.trim();
    const editBtn = document.getElementById('imports-edit-btn');
    const clearBtn = document.getElementById('imports-clear-btn');
    if (editBtn) editBtn.hidden = !hasFile;
    if (clearBtn) clearBtn.hidden = !hasFile;
  }

  importsInput.addEventListener('input', updateImportsUI);
  importsInput.addEventListener('change', updateImportsUI);

  return wrapper;
}

// Browse button: pick a YAML file via electronAPI.selectMacroFile and put its name in the input.
async function selectImportsFileDialog(inputElement) {
  try {
    const slug = window.editMode ? formState.slug_editMode : '';
    const result = await window.electronAPI.selectMacroFile(slug);

    if (result.success && result.filename) {
      inputElement.value = result.filename;
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));
      markDirty();
    } else if (!result.canceled) {
      console.error('Failed to select imports file:', result.error);
    }
  } catch (err) {
    console.error('Error in selectImportsFileDialog:', err);
  }
}

// Currently unused: older macros-only twin of selectImportsFileDialog.
export async function selectMacroFileDialog(inputElement) {
  try {
    const slug = window.editMode ? formState.slug_editMode : '';

    const result = await window.electronAPI.selectMacroFile(slug);

    if (result.success && result.filename) {
      inputElement.value = result.filename;
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));
      markDirty();
    } else if (!result.canceled) {
      console.error('Failed to select macro file:', result.error);
    }
  } catch (err) {
    console.error('Error in selectMacroFileDialog:', err);
  }
}

// Edit button: open the imports file in the external editor (electronAPI.openFileWithEditor).
async function openImportsFileInEditor(relativePath) {
  if (!relativePath || !relativePath.trim()) {
    console.warn('No imports file specified');
    return;
  }

  try {
    console.log(`[Imports] Opening external editor for: ${relativePath}`);
    const result = await window.electronAPI.openFileWithEditor(relativePath, formState.slug_editMode);

    if (!result.success) {
      console.error('Failed to open file:', result.error);
      alert(tf('Could not open file: {error}', { error: result.error }));
    }
  } catch (err) {
    console.error('Error opening imports file:', err);
    alert(tf('Error opening imports file: {error}', { error: err.message }));
  }
}

// Currently unused: older macros-only twin of openImportsFileInEditor.
export async function openMacroFileInEditor(relativePath) {
  if (!relativePath || !relativePath.trim()) {
    console.warn('No external macro file specified');
    return;
  }

  try {
    console.log(`[Macros] Opening external editor for: ${relativePath}`);
    const result = await window.electronAPI.openFileWithEditor(relativePath, formState.slug_editMode);

    if (!result.success) {
      console.error('Failed to open file:', result.error);
      alert(tf('Could not open file: {error}', { error: result.error }));
    }
  } catch (err) {
    console.error('Error opening macro file:', err);
    alert(tf('Error opening macro file: {error}', { error: err.message }));
  }
}

// Save Current button: write inline macros + media to shared-resources.yaml, link it, clear the inline copies.
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
        alert(t('Invalid macros JSON. Please fix any errors in your macros.'));
        console.error('Failed to parse macros:', err);
        return;
      }
    }

    if (mediaJson && mediaJson.value) {
      try {
        mediaObject = JSON.parse(mediaJson.value);
      } catch (err) {
        alert(t('Invalid media JSON. Please fix any errors in your media.'));
        console.error('Failed to parse media:', err);
        return;
      }
    }

    if (Object.keys(macrosObject).length === 0 && Object.keys(mediaObject).length === 0) {
      alert(t('No macros or media defined to save. Add some first.'));
      return;
    }

    const slug = window.editMode ? formState.slug_editMode : '';
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

      markDirty();
      alert(tf('Resources saved to: {filename}\n\nInline macros and media have been cleared. You can now edit the imports file or keep using it as-is.', { filename: result.filename }));
    } else {
      console.error('Failed to save resources:', result.error);
      alert(tf('Failed to save resources: {error}', { error: result.error }));
    }
  } catch (err) {
    console.error('Error in saveResourcesToFile:', err);
    alert(tf('Error saving resources: {error}', { error: err.message }));
  }
}

// Import button: choose a YAML file and load its macros and media into the inline editors.
async function importResourcesFromFile(inputElement) {
  try {
    const slug = window.editMode ? formState.slug_editMode : '';

    const selectResult = await window.electronAPI.selectMacroFile(slug);

    if (!selectResult.success) {
      if (!selectResult.canceled) {
        alert(tf('Failed to select file: {error}', { error: selectResult.error }));
      }
      return;
    }

    const filename = selectResult.filename;
    const isAbsolute = selectResult.isAbsolute || filename.startsWith('/');

    let fullPath = filename;
    if (!isAbsolute && window.editMode && formState.presentation_dir && formState.slug_editMode) {
      fullPath = formState.presentation_dir + '/' + formState.slug_editMode + '/' + filename;
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

      markDirty();
      const macroCount = (loadResult.macros && Object.keys(loadResult.macros).length) || 0;
      const mediaCount = (loadResult.media && Object.keys(loadResult.media).length) || 0;
      alert(tf('Imported {macros} macro(s) and {media} media item(s).', { macros: macroCount, media: mediaCount }));
    } else {
      alert(tf('Failed to load resources: {error}', { error: loadResult.error || t('Unknown error') }));
    }
  } catch (err) {
    console.error('Error in importResourcesFromFile:', err);
    alert(tf('Error importing resources: {error}', { error: err.message }));
  }
}

// Currently unused: older macros-only save to macros.yaml (needs #macros-external-input, which is gone).
export async function saveMacroSetToFile() {
  try {
    // Get current macros from the form
    const macrosJson = document.getElementById('macros-json');
    if (!macrosJson || !macrosJson.value) {
      alert(t('No macros defined to save. Add macros first.'));
      return;
    }

    let macrosObject = {};
    try {
      macrosObject = JSON.parse(macrosJson.value);
    } catch (err) {
      alert(t('Invalid macros JSON. Please fix any errors in your macros.'));
      console.error('Failed to parse macros:', err);
      return;
    }

    const slug = window.editMode ? formState.slug_editMode : '';

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

      markDirty();
      alert(tf('Macros saved to: {filename}\n\nInline macros have been cleared. You can now edit the external file or keep using it as-is.', { filename: result.filename }));
    } else {
      console.error('Failed to save macros:', result.error);
      alert(tf('Failed to save macro set: {error}', { error: result.error }));
    }
  } catch (err) {
    console.error('Error in saveMacroSetToFile:', err);
    alert(tf('Error saving macro set: {error}', { error: err.message }));
  }
}

// Currently unused: older macros-only import that loads macros from a chosen file into the inline editor.
export async function importMacroSetFromFile() {
  try {
    const slug = window.editMode ? formState.slug_editMode : '';

    // Select file
    const selectResult = await window.electronAPI.selectMacroFile(slug);

    if (!selectResult.success) {
      if (!selectResult.canceled) {
        alert(tf('Failed to select file: {error}', { error: selectResult.error }));
      }
      return;
    }

    const filename = selectResult.filename;
    const isAbsolute = selectResult.isAbsolute || filename.startsWith('/');

    let fullPath = filename;
    if (!isAbsolute && window.editMode && formState.presentation_dir && formState.slug_editMode) {
      fullPath = formState.presentation_dir + '/' + formState.slug_editMode + '/' + filename;
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

      markDirty();
      alert(tf('Imported {count} macro(s) into inline macros.', { count: Object.keys(loadResult.macros).length }));
    } else {
      alert(tf('Failed to load macros: {error}', { error: loadResult.error || t('Unknown error') }));
    }
  } catch (err) {
    console.error('Error in importMacroSetFromFile:', err);
    alert(tf('Error importing macro set: {error}', { error: err.message }));
  }
}
