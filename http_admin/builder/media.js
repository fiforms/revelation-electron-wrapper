/*
 * Media/tint/audio/format menus and insert helpers.
 *
 * Sections:
 * - Media/audio selection
 * - Media menu rendering
 * - Audio/format/tint menus
 * - Menu open/close handlers
 * - Storage handlers
 */
import {
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
  applyAudioMacroToBodyEditor,
  applyMacroInsertToTopEditor,
  applyMacroInsertToBodyEditor
} from './editor-actions.js';
import { renderTintMenu } from './tint.js';
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
  const entry = {
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
  if (item.large_variant && item.large_variant.filename) {
    entry.large_variant = {
      filename: item.large_variant.filename || '',
      original_filename: item.large_variant.original_filename || '',
      url_direct: item.large_variant.url_direct || ''
    };
  }
  data.media[normalized] = entry;
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

async function getProjectImages() {
  if (!window.electronAPI?.listPresentationImages) return null;
  if (!slug) return null;
  try {
    const images = await window.electronAPI.listPresentationImages(slug);
    return Array.isArray(images) ? images : [];
  } catch (err) {
    console.warn('Failed to load project images:', err);
    return [];
  }
}

// Render a dropdown list of media tags for insertion.
async function renderMediaMenu(menuEl, insertTarget) {
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

  const hasYaml = !!getYaml();
  let tags = [];
  let tagsError = null;
  if (!hasYaml) {
    tagsError = 'no-yaml';
  } else {
    const linked = getLinkedMediaTags();
    if (linked === null) {
      tagsError = 'invalid';
    } else {
      tags = linked;
    }
  }

  let projectImages = null;
  if (window.electronAPI?.listPresentationImages && slug) {
    addItem(tr('Loading project images…'), null, true);
    projectImages = await getProjectImages();
    menuEl.innerHTML = '';
  }

  if (tagsError === 'no-yaml') {
    addItem(tr('YAML support unavailable.'), null, true);
  } else if (tagsError === 'invalid') {
    addItem(tr('Invalid front matter.'), null, true);
  } else if (tags.length) {
    addItem(tr('Linked Media'), null, true);
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
  } else {
    addItem(tr('No linked media in front matter.'), null, true);
  }

  if (projectImages !== null) {
    if (projectImages.length) {
      addItem(tr('Project Images'), null, true);
      projectImages.forEach((item) => {
        addItem(item.filename, () => {
          closeMediaMenu();
          const tagType = insertTarget === 'top' ? 'backgroundsticky' : 'background';
          const encoded = encodeURIComponent(item.filename);
          const snippet = buildFileMarkdown(tagType, encoded, item.attribution, item.ai);
          if (!snippet) return;
          const useBackgroundInsert = snippet.trim().startsWith('![background');
          if (insertTarget === 'top') {
            if (useBackgroundInsert) {
              applyBackgroundInsertToEditor(topEditorEl, 'top', snippet);
            } else {
              applyInsertToEditor(topEditorEl, 'top', snippet);
            }
          } else if (useBackgroundInsert) {
            applyBackgroundInsertToEditor(editorEl, 'body', snippet);
          } else {
            applyInsertToEditor(editorEl, 'body', snippet);
          }
        });
      });
    } else {
      addItem(tr('No project images found.'), null, true);
    }
  }
}

// --- Audio/format/tint menus ---
function buildAudioMacro(command, src, insertTarget) {
  if (insertTarget === 'top') {
    if (command === 'stop') return '{{audio:stop}}';
    if (command === 'play') return `{{audio:play:${src}}}`;
    if (command === 'playloop') return `{{audio:playloop:${src}}}`;
    return '';
  }
  if (command === 'stop') return ':audio:stop:';
  if (command === 'play') return `:audio:play:${src}:`;
  if (command === 'playloop') return `:audio:playloop:${src}:`;
  return '';
}

function applyAudioMacroForTarget(macro, insertTarget) {
  if (!macro) return;
  if (insertTarget === 'top') {
    applyAudioMacroToTopEditor(macro);
  } else {
    applyAudioMacroToBodyEditor(macro);
  }
}

// Render audio action menu (play/loop/stop).
function renderAudioMenu(menuEl, insertTarget) {
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
    applyAudioMacroForTarget(buildAudioMacro('play', src, insertTarget), insertTarget);
  }, fileDisabled);
  addItem(tr('Loop audio…'), async () => {
    closeAudioMenu();
    const src = await selectAudioFile();
    if (!src) return;
    applyAudioMacroForTarget(buildAudioMacro('playloop', src, insertTarget), insertTarget);
  }, fileDisabled);
  addItem(tr('Stop audio'), () => {
    closeAudioMenu();
    applyAudioMacroForTarget(buildAudioMacro('stop', '', insertTarget), insertTarget);
  });
}

const formatMenuItems = [
  { label: 'Light Background', key: 'lightbg' },
  { label: 'Dark Background', key: 'darkbg' },
  { label: 'Light Text', key: 'lighttext' },
  { label: 'Dark Text', key: 'darktext' },
  { label: 'Shift Right', key: 'shiftright' },
  { label: 'Shift Left', key: 'shiftleft' },
  { label: 'Lower Third', key: 'lowerthird' },
  { label: 'Upper Third', key: 'upperthird' },
  { label: 'Info Slide', key: 'info' },
  { label: 'Info Slide Full', key: 'infofull' }
];

function buildFormatMacro(key, insertTarget) {
  return insertTarget === 'top' ? `{{${key}}}` : `:${key}:`;
}

// Render macro menu (light/dark/thirds/clear for top).
function renderFormatMenu(menuEl, insertTarget) {
  if (!menuEl) return;
  menuEl.innerHTML = '';
  const addItem = (label, macro) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'builder-dropdown-item';
    item.textContent = label;
    item.addEventListener('click', () => {
      closeFormatMenu();
      if (insertTarget === 'top') {
        applyMacroInsertToTopEditor(macro);
      } else {
        applyMacroInsertToBodyEditor(macro);
      }
    });
    menuEl.appendChild(item);
  };

  if (insertTarget === 'top') {
    addItem(tr('Clear Inherited Macros'), '{{}}');
  }
  formatMenuItems.forEach((item) => {
    addItem(tr(item.label), buildFormatMacro(item.key, insertTarget));
  });
}

// Tint menu rendering moved to tint.js.

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
function openAudioMenu(menuEl, buttonEl, insertTarget) {
  if (!menuEl || !buttonEl) return;
  closeAudioMenu();
  renderAudioMenu(menuEl, insertTarget);
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
function openFormatMenu(menuEl, buttonEl, insertTarget) {
  if (!menuEl || !buttonEl) return;
  closeFormatMenu();
  renderFormatMenu(menuEl, insertTarget);
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
  renderTintMenu(menuEl, closeTintMenu);
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
