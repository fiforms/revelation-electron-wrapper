/*
 * Media tab of the Create / Edit Metadata form: tile editor for the `media` front-matter map.
 *
 * Keeps the data as JSON in the hidden textarea #media-json (name="media", submitted by
 * create.js submitForm); renderMediaTiles() redraws #media-container from it, and the edit modal
 * (openMediaEditModal) and delete (deleteMediaItem) rewrite it. Reference counts per alias come
 * from formState.mediaUsageCounts (set by create.js in edit mode) and drive the rename/delete
 * warnings.
 *
 * Markup (field chrome, tile, edit modal) comes from the tpl-media-* templates in create/templates.html
 * via cloneTemplate(); this file only fills in data and wires handlers.
 *
 * Callers: create.js buildFormWithTabs() (createMedia), tab-imports.js (renderMediaTiles), and
 * core via the registry ('media', 'renderMediaTiles'; used by buildForm and setValues).
 * Gotchas: the "+ Add Media" button is intentionally hidden. Aliases are letters/digits/underscore.
 */
import { formState, lang, t, tf, registerFieldBuilder, cloneTemplate } from './metadata-form-core.js';

// Build the Media field chrome (label and hidden add button); tiles are drawn by renderMediaTiles().
export function createMedia(field) {
  const wrapper = cloneTemplate('tpl-media-field');
  wrapper.querySelector('[data-role="label"]').textContent = field.label && field.label[lang] ? field.label[lang] : t('Media');
  // "+ Add Media" is hidden in the template for now to avoid confusion.
  wrapper.querySelector('[data-role="add"]').onclick = () => openMediaEditModal(null);
  return wrapper;
}

// Redraw #media-container tiles from #media-json, with a usage-count badge per alias.
export function renderMediaTiles() {
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
    const tile = cloneTemplate('tpl-media-tile');
    tile.querySelector('[data-role="alias"]').textContent = alias;

    const usageCount = formState.mediaUsageCounts[alias] || 0;
    const badge = tile.querySelector('[data-role="badge"]');
    if (usageCount > 0) badge.classList.add('resource-tile-badge-used');
    badge.textContent = usageCount;

    tile.querySelector('[data-role="filename"]').textContent = data.filename || t('(no file)');

    const type = tile.querySelector('[data-role="type"]');
    if (data.mediatype) type.textContent = data.mediatype;
    else type.remove();

    tile.querySelector('[data-role="edit"]').onclick = () => openMediaEditModal(alias);
    tile.querySelector('[data-role="delete"]').onclick = () => deleteMediaItem(alias);
    container.appendChild(tile);
  }
}

// Open the edit modal for a media alias (null = new); saving rewrites #media-json and redraws tiles.
export function openMediaEditModal(alias) {
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

  const overlay = cloneTemplate('tpl-media-modal');
  const $ = (role) => overlay.querySelector(`[data-role="${role}"]`);

  $('title').textContent = alias ? tf('Edit Media: {alias}', { alias }) : t('Add New Media');
  $('close').onclick = () => {
    overlay.remove();
  };

  const aliasInput = $('alias');
  aliasInput.value = alias || '';
  const filenameInput = $('filename');
  filenameInput.value = currentData.filename || '';
  const titleInput = $('title-input');
  titleInput.value = currentData.title || '';
  const typeSelect = $('type');
  for (const option of typeSelect.options) {
    if (currentData.mediatype === option.value) option.selected = true;
  }
  const descInput = $('description');
  descInput.value = currentData.description || '';
  const attrInput = $('attribution');
  attrInput.value = currentData.attribution || '';
  const licenseInput = $('license');
  licenseInput.value = currentData.license || '';

  $('cancel').onclick = () => {
    overlay.remove();
  };

  $('save').onclick = () => {
    const newAlias = aliasInput.value.trim();
    if (!newAlias) {
      alert(t('Alias name is required'));
      return;
    }

    // Validate alias format (alphanumeric and underscore only)
    if (!/^[a-zA-Z0-9_]+$/.test(newAlias)) {
      alert(t('Alias can only contain letters, numbers, and underscores'));
      aliasInput.focus();
      return;
    }

    // Check for duplicate alias
    if (mediaData[newAlias] && newAlias !== alias) {
      alert(tf('An alias named "{alias}" already exists', { alias: newAlias }));
      return;
    }

    // Warn if renaming an alias that has references
    if (alias && newAlias !== alias) {
      const usageCount = formState.mediaUsageCounts[alias] || 0;
      if (usageCount > 0) {
        const message = tf('This alias appears to be referenced {count} time(s) in the markdown. Renaming it will break those references. Are you sure?', { count: usageCount });
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

// Remove a media alias from #media-json, confirming first if the markdown references it.
export function deleteMediaItem(alias) {
  const usageCount = formState.mediaUsageCounts[alias] || 0;

  let shouldDelete = false;

  if (usageCount === 0) {
    // No references, delete immediately without confirmation
    shouldDelete = true;
  } else {
    // Has references, show warning
    const message = tf('This alias appears to be referenced {count} time(s) in the markdown. Deleting it will likely leave your presentation broken. Are you sure?', { count: usageCount });
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

registerFieldBuilder('media', createMedia);
registerFieldBuilder('renderMediaTiles', renderMediaTiles);
