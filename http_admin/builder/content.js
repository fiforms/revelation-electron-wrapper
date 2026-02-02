/*
 * Content plugin loading and Add Content menu rendering.
 *
 * Sections:
 * - Plugin loading
 * - Add Content menu
 * - Storage handlers
 */
import {
  pluginLoader,
  tr,
  trFormat,
  addContentBtn,
  addContentMenu,
  state,
  slug,
  mdFile,
  dir,
  pendingContentInsert
} from './context.js';
import { setStatus } from './app-state.js';
import { extractFrontMatter, parseSlides } from './markdown.js';
import { insertSlideStacksAtPosition } from './slides.js';

let contentCreators = [];
let contentCreatorsReady = false;
let contentCreatorsLoading = false;

// --- Add Content menu ---
function updateAddContentState() {
  if (!addContentBtn) return;
  const disabled = !window.electronAPI?.pluginTrigger;
  addContentBtn.disabled = disabled;
  addContentBtn.title = disabled ? tr('Add Content is only available in the desktop app.') : '';
}

function renderAddContentMenu() {
  if (!addContentMenu) return;
  addContentMenu.innerHTML = '';
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
    addContentMenu.appendChild(item);
  };

  if (!contentCreatorsReady) {
    addItem(tr('Loading plugins…'), null, true);
    return;
  }
  if (!contentCreators.length) {
    addItem(tr('No content plugins available.'), null, true);
    return;
  }

  contentCreators.forEach((creator) => {
    addItem(creator.label, () => {
      closeAddContentMenu();
      const insertAt = { ...state.selected };
      const returnKey = `addcontent:builder:${slug}:${mdFile}:${Date.now()}`;
      pendingContentInsert.set(returnKey, { insertAt });
      localStorage.removeItem(returnKey);
      try {
        creator.action({
          slug,
          mdFile,
          returnKey,
          origin: 'builder'
        });
      } catch (err) {
        console.error('Add content failed:', err);
        window.alert(trFormat('Failed to start {label}: {message}', { label: creator.label, message: err.message }));
      }
    });
  });
}

function openAddContentMenu() {
  if (!addContentMenu || !addContentBtn || addContentBtn.disabled) return;
  renderAddContentMenu();
  addContentMenu.hidden = false;
  addContentBtn.classList.add('is-active');
  document.addEventListener('click', handleAddContentOutsideClick);
  document.addEventListener('keydown', handleAddContentKeydown);
}

function closeAddContentMenu() {
  if (!addContentMenu || !addContentBtn) return;
  addContentMenu.hidden = true;
  addContentBtn.classList.remove('is-active');
  document.removeEventListener('click', handleAddContentOutsideClick);
  document.removeEventListener('keydown', handleAddContentKeydown);
}

function handleAddContentOutsideClick(event) {
  if (!addContentMenu || !addContentBtn) return;
  if (addContentMenu.contains(event.target) || addContentBtn.contains(event.target)) return;
  closeAddContentMenu();
}

function handleAddContentKeydown(event) {
  if (event.key === 'Escape') {
    closeAddContentMenu();
  }
}

// --- Plugin loading ---
function getPluginKey() {
  if (!dir) return null;
  const match = dir.match(/^presentations_(.+)$/);
  return match ? match[1] : null;
}

function collectContentCreators() {
  if (!window.RevelationPlugins) return [];
  const plugins = Object.entries(window.RevelationPlugins)
    .map(([name, plugin]) => ({
      name,
      plugin,
      priority: plugin.priority ?? 999
    }))
    .sort((a, b) => a.priority - b.priority);
  const creators = [];
  for (const { name, plugin } of plugins) {
    if (typeof plugin.getContentCreators === 'function') {
      const items = plugin.getContentCreators({ slug, md: mdFile, mdFile, dir });
      if (Array.isArray(items)) {
        items.forEach((item) => {
          if (!item || typeof item.label !== 'string' || typeof item.action !== 'function') return;
          creators.push({ ...item, pluginName: name });
        });
      }
    }
  }
  return creators;
}

async function loadContentCreators() {
  if (contentCreatorsLoading) return;
  contentCreatorsLoading = true;
  try {
    const key = getPluginKey();
    await pluginLoader('builder', key ? `/plugins_${key}` : '');
    contentCreators = collectContentCreators();
    contentCreatorsReady = true;
  } catch (err) {
    console.warn('Failed to load builder plugins:', err);
    contentCreators = [];
    contentCreatorsReady = true;
  } finally {
    contentCreatorsLoading = false;
    updateAddContentState();
  }
}

// --- Storage handlers ---
function insertSlidesFromMarkdown(rawMarkdown, insertAt) {
  if (!rawMarkdown || typeof rawMarkdown !== 'string') return false;
  const { body } = extractFrontMatter(rawMarkdown);
  const trimmed = body.trim();
  if (!trimmed) return false;
  const stacks = parseSlides(trimmed);
  return insertSlideStacksAtPosition(stacks, insertAt);
}

function handleContentInsertStorage(event) {
  if (!event.key || !pendingContentInsert.has(event.key) || !event.newValue) return false;
  let payload;
  try {
    payload = JSON.parse(event.newValue);
  } catch (err) {
    console.warn('Invalid content payload:', err);
    return false;
  }
  const pending = pendingContentInsert.get(event.key);
  pendingContentInsert.delete(event.key);
  localStorage.removeItem(event.key);

  if (payload?.canceled) {
    setStatus(tr('Content insert canceled.'));
    return true;
  }

  let inserted = false;
  if (Array.isArray(payload?.stacks)) {
    inserted = insertSlideStacksAtPosition(payload.stacks, pending?.insertAt);
  } else if (Array.isArray(payload?.slides)) {
    inserted = insertSlideStacksAtPosition([payload.slides], pending?.insertAt);
  } else {
    const markdown = payload?.markdown || payload?.content || '';
    inserted = insertSlidesFromMarkdown(markdown, pending?.insertAt);
  }

  if (!inserted) {
    window.alert(tr('No content was returned from the plugin.'));
  } else {
    setStatus(tr('Content inserted.'));
  }
  return true;
}

export {
  updateAddContentState,
  renderAddContentMenu,
  openAddContentMenu,
  closeAddContentMenu,
  loadContentCreators,
  handleContentInsertStorage
};
