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
import { extractFrontMatter, parseSlides, getNoteSeparatorFromFrontmatter } from './markdown.js';
import { insertSlideStacksAtPosition } from './slides.js';

let contentCreators = [];
let contentCreatorsReady = false;
let contentCreatorsLoading = false;

// --- Add Content menu ---
function updateAddContentState() {
  if (!addContentBtn) return;
  const disabled = contentCreatorsReady && contentCreators.length === 0;
  addContentBtn.disabled = disabled;
  addContentBtn.title = disabled ? tr('No content plugins available.') : '';
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
      runContentCreator(creator).catch((err) => {
        console.error('Add content failed:', err);
        window.alert(trFormat('Failed to start {label}: {message}', { label: creator.label, message: err.message }));
      });
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
    if (typeof plugin.getBuilderTemplates === 'function') {
      const items = plugin.getBuilderTemplates({ slug, md: mdFile, mdFile, dir });
      if (Array.isArray(items)) {
        items.forEach((item) => {
          const label = item?.label || item?.title;
          if (!label || typeof label !== 'string') return;
          creators.push({
            kind: 'builder-template',
            label,
            item,
            pluginName: name
          });
        });
      }
    }

    if (typeof plugin.getContentCreators === 'function') {
      const items = plugin.getContentCreators({ slug, md: mdFile, mdFile, dir });
      if (Array.isArray(items)) {
        items.forEach((item) => {
          if (!item || typeof item.label !== 'string' || typeof item.action !== 'function') return;
          creators.push({ kind: 'legacy-content-creator', ...item, pluginName: name });
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
  const { frontmatter, body } = extractFrontMatter(rawMarkdown);
  const trimmed = body.trim();
  if (!trimmed) return false;
  const noteSeparator = frontmatter
    ? getNoteSeparatorFromFrontmatter(frontmatter)
    : (state.noteSeparator || ':note:');
  const stacks = parseSlides(trimmed, noteSeparator);
  return insertSlideStacksAtPosition(stacks, insertAt);
}

function insertContentPayload(payload, insertAt) {
  if (Array.isArray(payload?.stacks)) {
    return insertSlideStacksAtPosition(payload.stacks, insertAt);
  }
  if (Array.isArray(payload?.slides)) {
    return insertSlideStacksAtPosition([payload.slides], insertAt);
  }
  if (typeof payload === 'string') {
    return insertSlidesFromMarkdown(payload, insertAt);
  }
  const markdown = payload?.markdown || payload?.content || payload?.template || '';
  return insertSlidesFromMarkdown(markdown, insertAt);
}

function resolveBuilderTemplatePayload(item) {
  if (Array.isArray(item?.stacks)) return { stacks: item.stacks };
  if (Array.isArray(item?.slides)) return { slides: item.slides };
  if (typeof item?.markdown === 'string') return { markdown: item.markdown };
  if (typeof item?.content === 'string') return { content: item.content };
  if (typeof item?.template === 'string') return { template: item.template };
  return null;
}

function makeBuilderTemplateContext(insertAt, hooks = {}) {
  return {
    slug,
    mdFile,
    dir,
    origin: 'builder',
    insertAt: { ...insertAt },
    insertContent(payload) {
      const inserted = insertContentPayload(payload, insertAt);
      if (inserted && typeof hooks.onInserted === 'function') {
        hooks.onInserted();
      }
      return inserted;
    }
  };
}

async function runBuilderTemplateCreator(creator, insertAt) {
  const item = creator.item || {};
  let callbackInserted = false;
  const context = makeBuilderTemplateContext(insertAt, {
    onInserted() {
      callbackInserted = true;
    }
  });
  const builderCallback = typeof item.onSelect === 'function'
    ? item.onSelect
    : (typeof item.build === 'function' ? item.build : null);

  let payload = resolveBuilderTemplatePayload(item);
  if (builderCallback) {
    const callbackResult = await builderCallback(context);
    if (callbackResult !== undefined) {
      payload = callbackResult;
    } else if (callbackInserted) {
      setStatus(tr('Content inserted.'));
      return;
    }
  }

  if (payload?.canceled) {
    setStatus(tr('Content insert canceled.'));
    return;
  }

  const inserted = insertContentPayload(payload, insertAt);
  if (!inserted) {
    window.alert(tr('No content was returned from the plugin.'));
    return;
  }
  setStatus(tr('Content inserted.'));
}

async function runLegacyContentCreator(creator, insertAt) {
  const returnKey = `addcontent:builder:${slug}:${mdFile}:${Date.now()}`;
  pendingContentInsert.set(returnKey, { insertAt });
  localStorage.removeItem(returnKey);
  await creator.action({
    slug,
    mdFile,
    returnKey,
    origin: 'builder'
  });
}

async function runContentCreator(creator) {
  const insertAt = { ...state.selected };
  if (creator.kind === 'builder-template') {
    await runBuilderTemplateCreator(creator, insertAt);
    return;
  }
  await runLegacyContentCreator(creator, insertAt);
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

  const inserted = insertContentPayload(payload, pending?.insertAt);

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
