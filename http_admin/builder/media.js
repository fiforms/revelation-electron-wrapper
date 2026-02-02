/*
 * Media/tint/audio/format menus and insert helpers.
 *
 * Sections:
 * - Color + tint helpers
 * - Media/audio selection
 * - Media menu rendering
 * - Audio/format/tint menus
 * - Menu open/close handlers
 * - Storage handlers
 */
import {
  tr,
  trFormat,
  slug,
  mdFile,
  pendingAddMedia,
  topEditorEl,
  editorEl,
  state
} from './context.js';
import {
  buildMediaMarkdown,
  buildFileMarkdown,
  getYaml,
  parseFrontMatterText,
  stringifyFrontMatter
} from './markdown.js';
import {
  applyInsertToEditor,
  applyBackgroundInsertToEditor,
  applyAudioMacroToTopEditor,
  applyBgtintInsertToTopEditor,
  applyMacroInsertToTopEditor,
  stripMacroLines
} from './editor-actions.js';
import { markDirty } from './app-state.js';
import { schedulePreviewUpdate } from './preview.js';

let activeMediaMenu = null;
let activeMediaButton = null;
let activeAudioMenu = null;
let activeAudioButton = null;
let activeFormatMenu = null;
let activeFormatButton = null;
let activeTintMenu = null;
let activeTintButton = null;

// --- Color + tint helpers ---
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

// --- Media/audio selection ---
// Ask the desktop app to pick an audio file and return its encoded path.
async function selectAudioFile() {
  if (!window.electronAPI?.pluginTrigger) {
    window.alert(tr('Audio selection is only available in the desktop app.'));
    return null;
  }
  if (!slug || !mdFile) {
    window.alert(tr('Missing presentation metadata.'));
    return null;
  }
  try {
    const result = await window.electronAPI.pluginTrigger('addmedia', 'add-selected-audio', {
      slug,
      mdFile
    });
    if (!result?.success) {
      if (result?.error && result.error !== 'No file selected') {
        window.alert(trFormat('Audio selection failed: {message}', { message: result.error }));
      }
      return null;
    }
    return result.encoded || result.filename || null;
  } catch (err) {
    console.error(err);
    window.alert(trFormat('Audio selection failed: {message}', { message: err.message }));
    return null;
  }
}

// Add or update a media entry in the YAML front matter.
function addMediaToFrontmatter(tag, item) {
  const yaml = getYaml();
  if (!yaml) {
    window.alert(tr('Media insert requires YAML support.'));
    return false;
  }
  const normalized = tag.toLowerCase();
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    window.alert(tr('Media tag must use lowercase letters, numbers, and underscores only.'));
    return false;
  }
  const data = parseFrontMatterText(state.frontmatter);
  if (data === null) {
    window.alert(tr('Failed to parse front matter. Please fix it before inserting media.'));
    return false;
  }
  if (!data.media) data.media = {};
  const existing = data.media[normalized];
  if (existing && existing.filename && existing.filename !== item.filename) {
    window.alert(trFormat('Media tag "{tag}" already exists.', { tag: normalized }));
    return false;
  }
  data.media[normalized] = {
    filename: item.filename || '',
    title: item.title || '',
    mediatype: item.mediatype || '',
    description: item.description || '',
    attribution: item.attribution || '',
    license: item.license || '',
    url_origin: item.url_origin || '',
    url_library: item.url_library || '',
    url_direct: item.url_direct || ''
  };
  state.frontmatter = stringifyFrontMatter(data);
  markDirty();
  schedulePreviewUpdate();
  return true;
}

// Trigger the Add Media plugin dialog and track its return key.
function openAddMediaDialog(insertTarget) {
  if (!window.electronAPI?.pluginTrigger) {
    window.alert(tr('Media insert is only available in the desktop app.'));
    return;
  }
  if (!slug || !mdFile) {
    window.alert(tr('Missing presentation metadata.'));
    return;
  }
  const returnKey = `addmedia:builder:${slug}:${mdFile}:${Date.now()}`;
  pendingAddMedia.set(returnKey, { insertTarget });
  localStorage.removeItem(returnKey);
  const tagType = insertTarget === 'top' ? 'backgroundsticky' : 'normal';
  window.electronAPI.pluginTrigger('addmedia', 'add-media', {
    slug,
    mdFile,
    returnKey,
    insertTarget,
    tagType,
    origin: 'builder'
  }).catch((err) => {
    console.error(err);
    window.alert(trFormat('Failed to open media dialog: {message}', { message: err.message }));
  });
}

// --- Media menu rendering ---
// Return sorted media tag names from front matter.
function getLinkedMediaTags() {
  const data = parseFrontMatterText(state.frontmatter);
  if (!data) return null;
  const media = data.media;
  if (!media || typeof media !== 'object') return [];
  return Object.keys(media)
    .filter((tag) => typeof tag === 'string' && tag.trim() !== '')
    .sort((a, b) => a.localeCompare(b));
}

// Render a dropdown list of media tags for insertion.
function renderMediaMenu(menuEl, insertTarget) {
  if (!menuEl) return;
  menuEl.innerHTML = '';
  const addItem = (label, onClick, disabled = false) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'builder-dropdown-item';
    item.textContent = label;
    if (disabled) {
      item.classList.add('is-disabled');
      item.disabled = true;
    } else {
      item.addEventListener('click', onClick);
    }
    menuEl.appendChild(item);
  };

  if (!getYaml()) {
    addItem(tr('YAML support unavailable.'), null, true);
    return;
  }

  const tags = getLinkedMediaTags();
  if (tags === null) {
    addItem(tr('Invalid front matter.'), null, true);
    return;
  }
  if (!tags.length) {
    addItem(tr('No linked media in front matter.'), null, true);
    return;
  }

  tags.forEach((tag) => {
    addItem(tag, () => {
      closeMediaMenu();
      const tagType = insertTarget === 'top' ? 'backgroundsticky' : 'background';
      const snippet = buildMediaMarkdown(tagType, tag);
      if (!snippet) return;
      if (insertTarget === 'top') {
        applyBackgroundInsertToEditor(topEditorEl, 'top', snippet);
      } else {
        applyBackgroundInsertToEditor(editorEl, 'body', snippet);
      }
    });
  });
}

// --- Audio/format/tint menus ---
// Render audio action menu (play/loop/stop).
function renderAudioMenu(menuEl) {
  if (!menuEl) return;
  menuEl.innerHTML = '';
  const addItem = (label, onClick, disabled = false) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'builder-dropdown-item';
    item.textContent = label;
    if (disabled) {
      item.classList.add('is-disabled');
      item.disabled = true;
    } else {
      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      });
    }
    menuEl.appendChild(item);
  };

  const fileDisabled = !window.electronAPI?.pluginTrigger;
  addItem(tr('Play audio…'), async () => {
    closeAudioMenu();
    const src = await selectAudioFile();
    if (!src) return;
    applyAudioMacroToTopEditor(`{{audio:play:${src}}}`);
  }, fileDisabled);
  addItem(tr('Loop audio…'), async () => {
    closeAudioMenu();
    const src = await selectAudioFile();
    if (!src) return;
    applyAudioMacroToTopEditor(`{{audio:playloop:${src}}}`);
  }, fileDisabled);
  addItem(tr('Stop audio'), () => {
    closeAudioMenu();
    applyAudioMacroToTopEditor('{{audio:stop}}');
  });
}

// Render top-matter macro menu (light/dark/thirds/clear).
function renderFormatMenu(menuEl) {
  if (!menuEl) return;
  menuEl.innerHTML = '';
  const addItem = (label, macro) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'builder-dropdown-item';
    item.textContent = label;
    item.addEventListener('click', () => {
      closeFormatMenu();
      applyMacroInsertToTopEditor(macro);
    });
    menuEl.appendChild(item);
  };

  addItem(tr('Clear Inherited Macros'), '{{}}');
  addItem(tr('Light Background'), '{{lightbg}}');
  addItem(tr('Dark Background'), '{{darkbg}}');
  addItem(tr('Lower Third'), '{{lowerthird}}');
  addItem(tr('Upper Third'), '{{upperthird}}');
}

// Render tint picker UI with live preview and insert/clear actions.
function renderTintMenu(menuEl) {
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
    const rgb = hexToRgb(colorInput.value) || { r: 64, g: 96, b: 96 };
    const alpha = clamp(parseFloat(alphaInput.value), 0, 1);
    closeTintMenu();
    applyBgtintInsertToTopEditor(`rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`);
  });

  clearBtn.addEventListener('click', () => {
    closeTintMenu();
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

// --- Menu open/close handlers ---
// Open a media tag menu and register outside/escape handlers.
function openMediaMenu(menuEl, buttonEl, insertTarget) {
  if (!menuEl || !buttonEl) return;
  closeMediaMenu();
  renderMediaMenu(menuEl, insertTarget);
  menuEl.hidden = false;
  buttonEl.classList.add('is-active');
  activeMediaMenu = menuEl;
  activeMediaButton = buttonEl;
  document.addEventListener('click', handleMediaOutsideClick);
  document.addEventListener('keydown', handleMediaKeydown);
}

// Close the active media tag menu.
function closeMediaMenu() {
  if (!activeMediaMenu || !activeMediaButton) return;
  activeMediaMenu.hidden = true;
  activeMediaButton.classList.remove('is-active');
  document.removeEventListener('click', handleMediaOutsideClick);
  document.removeEventListener('keydown', handleMediaKeydown);
  activeMediaMenu = null;
  activeMediaButton = null;
}

// Close media menu on outside click.
function handleMediaOutsideClick(event) {
  if (!activeMediaMenu || !activeMediaButton) return;
  if (activeMediaMenu.contains(event.target) || activeMediaButton.contains(event.target)) return;
  closeMediaMenu();
}

// Close media menu on Escape key.
function handleMediaKeydown(event) {
  if (event.key === 'Escape') {
    closeMediaMenu();
  }
}

// Open audio menu and register outside/escape handlers.
function openAudioMenu(menuEl, buttonEl) {
  if (!menuEl || !buttonEl) return;
  closeAudioMenu();
  renderAudioMenu(menuEl);
  menuEl.hidden = false;
  buttonEl.classList.add('is-active');
  activeAudioMenu = menuEl;
  activeAudioButton = buttonEl;
  document.addEventListener('click', handleAudioOutsideClick);
  document.addEventListener('keydown', handleAudioKeydown);
}

// Close the active audio menu.
function closeAudioMenu() {
  if (!activeAudioMenu || !activeAudioButton) return;
  activeAudioMenu.hidden = true;
  activeAudioButton.classList.remove('is-active');
  document.removeEventListener('click', handleAudioOutsideClick);
  document.removeEventListener('keydown', handleAudioKeydown);
  activeAudioMenu = null;
  activeAudioButton = null;
}

// Close audio menu on outside click.
function handleAudioOutsideClick(event) {
  if (!activeAudioMenu || !activeAudioButton) return;
  if (activeAudioMenu.contains(event.target) || activeAudioButton.contains(event.target)) return;
  closeAudioMenu();
}

// Close audio menu on Escape key.
function handleAudioKeydown(event) {
  if (event.key === 'Escape') {
    closeAudioMenu();
  }
}

// Open format menu and register outside/escape handlers.
function openFormatMenu(menuEl, buttonEl) {
  if (!menuEl || !buttonEl) return;
  closeFormatMenu();
  renderFormatMenu(menuEl);
  menuEl.hidden = false;
  buttonEl.classList.add('is-active');
  activeFormatMenu = menuEl;
  activeFormatButton = buttonEl;
  document.addEventListener('click', handleFormatOutsideClick);
  document.addEventListener('keydown', handleFormatKeydown);
}

// Close the active format menu.
function closeFormatMenu() {
  if (!activeFormatMenu || !activeFormatButton) return;
  activeFormatMenu.hidden = true;
  activeFormatButton.classList.remove('is-active');
  document.removeEventListener('click', handleFormatOutsideClick);
  document.removeEventListener('keydown', handleFormatKeydown);
  activeFormatMenu = null;
  activeFormatButton = null;
}

// Close format menu on outside click.
function handleFormatOutsideClick(event) {
  if (!activeFormatMenu || !activeFormatButton) return;
  if (activeFormatMenu.contains(event.target) || activeFormatButton.contains(event.target)) return;
  closeFormatMenu();
}

// Close format menu on Escape key.
function handleFormatKeydown(event) {
  if (event.key === 'Escape') {
    closeFormatMenu();
  }
}

// Open tint menu and register outside/escape handlers.
function openTintMenu(menuEl, buttonEl) {
  if (!menuEl || !buttonEl) return;
  closeTintMenu();
  renderTintMenu(menuEl);
  menuEl.hidden = false;
  buttonEl.classList.add('is-active');
  activeTintMenu = menuEl;
  activeTintButton = buttonEl;
  document.addEventListener('click', handleTintOutsideClick);
  document.addEventListener('keydown', handleTintKeydown);
}

// Close the active tint menu.
function closeTintMenu() {
  if (!activeTintMenu || !activeTintButton) return;
  activeTintMenu.hidden = true;
  activeTintButton.classList.remove('is-active');
  document.removeEventListener('click', handleTintOutsideClick);
  document.removeEventListener('keydown', handleTintKeydown);
  activeTintMenu = null;
  activeTintButton = null;
}

// Close tint menu on outside click.
function handleTintOutsideClick(event) {
  if (!activeTintMenu || !activeTintButton) return;
  if (activeTintMenu.contains(event.target) || activeTintButton.contains(event.target)) return;
  closeTintMenu();
}

// Close tint menu on Escape key.
function handleTintKeydown(event) {
  if (event.key === 'Escape') {
    closeTintMenu();
  }
}

// --- Storage handlers ---
// Process plugin payloads returned via localStorage events.
function handleAddMediaStorage(event) {
  if (!event.key || !pendingAddMedia.has(event.key) || !event.newValue) return false;
  let payload;
  try {
    payload = JSON.parse(event.newValue);
  } catch (err) {
    console.warn('Invalid media payload:', err);
    return false;
  }
  const pending = pendingAddMedia.get(event.key);
  pendingAddMedia.delete(event.key);
  localStorage.removeItem(event.key);
  if (!payload?.item || !payload?.tag) {
    if (payload?.mode !== 'file') {
      window.alert(tr('Media selection was incomplete.'));
      return true;
    }
  }
  if (payload?.mode !== 'file') {
    const ok = addMediaToFrontmatter(payload.tag, payload.item);
    if (!ok) return true;
  }
  const insertTarget = payload.insertTarget || pending?.insertTarget;
  const snippet = payload?.mode === 'file'
    ? buildFileMarkdown(payload.tagType, payload.encoded || payload.filename, payload.attrib, payload.ai)
    : buildMediaMarkdown(payload.tagType, payload.tag);
  if (!snippet) return true;
  const useBackgroundInsert = snippet.trim().startsWith('![background');
  if (insertTarget === 'top') {
    if (useBackgroundInsert) {
      applyBackgroundInsertToEditor(topEditorEl, 'top', snippet);
    } else {
      applyInsertToEditor(topEditorEl, 'top', snippet);
    }
  } else {
    if (useBackgroundInsert) {
      applyBackgroundInsertToEditor(editorEl, 'body', snippet);
    } else {
      applyInsertToEditor(editorEl, 'body', snippet);
    }
  }
  return true;
}

export {
  openAddMediaDialog,
  renderMediaMenu,
  openMediaMenu,
  closeMediaMenu,
  openAudioMenu,
  closeAudioMenu,
  openFormatMenu,
  closeFormatMenu,
  openTintMenu,
  closeTintMenu,
  handleAddMediaStorage
};
