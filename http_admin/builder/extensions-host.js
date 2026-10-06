/*
 * Builder extension host API and plugin contribution loader.
 *
 * Sections:
 * - Host bootstrap + events
 * - Transactions
 * - UI contribution registries
 * - Plugin contribution loader
 *
 * Creates window.RevelationBuilderHost (version 1.0, apiVersion 2), the only supported way
 * for plugins to extend the builder. Plugins (window.RevelationPlugins[name], loaded by
 * /js/pluginloader.js) may implement these hooks:
 *   getBuilderExtensions({host,slug,mdFile,dir}) -> [{ kind: 'mode' | 'panel' |
 *       'preview-overlay' | 'toolbar-action' | 'slide-navigator-renderer', ... }]
 *       (this file; a mode with location 'view-tabs' becomes a Visual/Markdown/Split-style tab)
 *   getBuilderTemplates() / getContentCreators()   Add Content menu entries (content.js)
 *   getSlideTools()                                Slide Tools menu entries (menus.js)
 *   onBuilderSmartPaste(payload)                   clipboard transform hook (smart-paste.js)
 * Host methods: getDocument, getMetadata, getSelection, getUiState, on(event, fn),
 * transact(label, fn(tx)) (tx.setSelection/moveSlide/moveColumn/insertSlides/splitSlide/
 * replaceColumn/replaceStacks/mergeMediaEntries), register{Mode,PreviewButton,Panel,
 * PreviewOverlay,ToolbarAction,KeyboardShortcut,SlideNavigatorRenderer,SaveGuard},
 * set/getActiveMode, openDialog, notify, plus triggerContentCreator (added by events.js).
 * Events: selection:changed, document:changed, mode:changed, preview:ready,
 * preview:slidechanged, preview:dblclick, preview-button:changed, save:before, save:after,
 * history:flush. Internal hooks used by the rest of the builder (do not call from plugins):
 * window.__revelationBuilderHostInternalEmit / ...InternalRunSaveGuards.
 * transact() is the undo-safe way to mutate stacks: it marks dirty and refreshes the preview,
 * and history.js records the result through the dirty listener.
 */
import {
  slug,
  mdFile,
  dir,
  state
} from './context.js';
import { createEmptySlide, parseFrontMatterText, stringifyFrontMatter } from './markdown.js';
import { markDirty, showBuilderToast } from './app-state.js';
import { selectSlide, syncPreviewToEditor } from './slides.js';
import { schedulePreviewUpdate } from './preview.js';
import { setWorkspaceTab, setWorkspaceExitHandler } from './layout.js';

const HOST_VERSION = '1.0';
const HOST_API_VERSION = 2;
const DEFAULT_EVENT_TIMEOUT_MS = 0;

const hostState = {
  initialized: false,
  host: null,
  listeners: new Map(),
  modeRegistry: new Map(),
  modeButtons: new Map(),
  modeInstances: new Map(),
  workspaceRoots: new Map(),
  previewButtons: new Map(),
  shortcutRegistry: new Map(),
  saveGuards: new Set(),
  activeModeId: '',
  slideNavigatorRenderer: null,
  containers: {
    previewHeader: null,
    leftHeader: null,
    toolbar: null,
    previewBody: null,
    leftPanelsRoot: null,
    viewTabs: null,
    workspace: null
  }
};

function deepClone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function emit(eventName, payload = {}) {
  const callbacks = hostState.listeners.get(eventName);
  if (callbacks && callbacks.size > 0) {
    callbacks.forEach((cb) => {
      try {
        cb(payload);
      } catch (err) {
        console.warn(`[builder-host] Event listener failed for '${eventName}':`, err);
      }
    });
  }
  const activeInstance = hostState.modeInstances.get(hostState.activeModeId);
  if (!activeInstance) return;
  try {
    if (eventName === 'selection:changed' && typeof activeInstance.onSelectionChanged === 'function') {
      activeInstance.onSelectionChanged(payload);
    } else if (eventName === 'document:changed' && typeof activeInstance.onDocumentChanged === 'function') {
      activeInstance.onDocumentChanged(payload);
    }
  } catch (err) {
    console.warn(`[builder-host] Active mode event '${eventName}' failed:`, err);
  }
}

function on(eventName, handler) {
  if (!eventName || typeof handler !== 'function') {
    return () => {};
  }
  if (!hostState.listeners.has(eventName)) {
    hostState.listeners.set(eventName, new Set());
  }
  const listeners = hostState.listeners.get(eventName);
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
    if (!listeners.size) {
      hostState.listeners.delete(eventName);
    }
  };
}

function registerSaveGuard(fn) {
  if (typeof fn !== 'function') return () => {};
  hostState.saveGuards.add(fn);
  return () => { hostState.saveGuards.delete(fn); };
}

async function runSaveGuards(payload) {
  for (const guard of hostState.saveGuards) {
    try {
      const proceed = await guard(payload);
      if (proceed === false) return false;
    } catch (err) {
      console.warn('[builder-host] Save guard threw:', err);
    }
  }
  return true;
}

function normalizeSlide(input) {
  const slide = input && typeof input === 'object' ? input : {};
  return {
    top: String(slide.top || ''),
    body: String(slide.body || ''),
    notes: String(slide.notes || '')
  };
}

function ensureNonEmptyStacks(nextStacks) {
  if (!Array.isArray(nextStacks) || !nextStacks.length) {
    return [[createEmptySlide()]];
  }
  const normalized = nextStacks
    .map((column) => (Array.isArray(column) ? column.map(normalizeSlide) : []))
    .map((column) => (column.length ? column : [createEmptySlide()]));
  return normalized.length ? normalized : [[createEmptySlide()]];
}

function clampSelection(position = {}) {
  const maxH = Math.max(state.stacks.length - 1, 0);
  const h = Math.min(Math.max(Number(position.h) || 0, 0), maxH);
  const column = state.stacks[h] || [];
  const maxV = Math.max(column.length - 1, 0);
  const v = Math.min(Math.max(Number(position.v) || 0, 0), maxV);
  return { h, v };
}

function moveArrayItem(list, fromIndex, toIndex) {
  if (!Array.isArray(list)) return false;
  const from = Number(fromIndex);
  const to = Number(toIndex);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return false;
  if (from === to) return true;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return true;
}

function createTransaction() {
  return {
    setSelection(position) {
      const next = clampSelection(position);
      state.selected = { h: next.h, v: next.v };
    },

    moveSlide(from, to) {
      const fromH = Number(from?.h);
      const fromV = Number(from?.v);
      const toH = Number(to?.h);
      const toV = Number(to?.v);
      if (![fromH, fromV, toH, toV].every(Number.isInteger)) return;
      if (!state.stacks[fromH] || !state.stacks[toH]) return;
      if (fromV < 0 || fromV >= state.stacks[fromH].length) return;
      const source = state.stacks[fromH];
      const [slide] = source.splice(fromV, 1);
      if (!slide) return;
      if (!source.length) {
        state.stacks[fromH] = [createEmptySlide()];
      }
      const targetColumn = state.stacks[toH] || (state.stacks[toH] = [createEmptySlide()]);
      const insertIndex = Math.max(0, Math.min(toV, targetColumn.length));
      targetColumn.splice(insertIndex, 0, normalizeSlide(slide));
      state.selected = clampSelection({ h: toH, v: insertIndex });
    },

    moveColumn(fromH, toH) {
      if (!moveArrayItem(state.stacks, fromH, toH)) return;
      const selectedH = state.selected.h;
      if (selectedH === fromH) {
        state.selected.h = toH;
      } else if (fromH < selectedH && toH >= selectedH) {
        state.selected.h -= 1;
      } else if (fromH > selectedH && toH <= selectedH) {
        state.selected.h += 1;
      }
      state.selected = clampSelection(state.selected);
    },

    insertSlides(at, slides) {
      const h = Number(at?.h);
      const v = Number(at?.v);
      if (!Number.isInteger(h) || !Number.isInteger(v)) return;
      const normalizedSlides = Array.isArray(slides)
        ? slides.map(normalizeSlide).filter((slide) => slide.top || slide.body || slide.notes)
        : [];
      if (!normalizedSlides.length) return;
      if (!state.stacks[h]) {
        state.stacks[h] = [createEmptySlide()];
      }
      const column = state.stacks[h];
      const insertAt = Math.max(0, Math.min(v + 1, column.length));
      column.splice(insertAt, 0, ...normalizedSlides);
      state.selected = clampSelection({ h, v: insertAt });
    },

    // Break a slide in two, like Ctrl+Enter in the markdown editor: the slide
    // keeps `before` (and its top matter and notes), and a new slide holding
    // `after` is inserted below it and selected, even when `after` is empty.
    splitSlide(at, { before = '', after = '' } = {}) {
      const h = Number(at?.h);
      const v = Number(at?.v);
      if (!Number.isInteger(h) || !Number.isInteger(v)) return;
      const column = state.stacks[h];
      if (!column || !column[v]) return;
      column[v].body = String(before).trim();
      column.splice(v + 1, 0, { ...createEmptySlide(), body: String(after).trim() });
      state.selected = { h, v: v + 1 };
    },

    replaceColumn(h, slides) {
      const columnIndex = Number(h);
      if (!Number.isInteger(columnIndex) || columnIndex < 0) return;
      const replacement = Array.isArray(slides)
        ? slides.map(normalizeSlide).filter((slide) => slide.top || slide.body || slide.notes)
        : [];
      state.stacks[columnIndex] = replacement.length ? replacement : [createEmptySlide()];
      state.selected = clampSelection(state.selected);
    },

    // Adds media alias entries (tag -> entry) to the front matter. A tag that
    // already exists with a different filename gets a numeric suffix. Returns
    // { oldTag: newTag } for every tag that was requested.
    mergeMediaEntries(entries) {
      const mapping = {};
      if (!entries || typeof entries !== 'object') return mapping;
      const data = parseFrontMatterText(String(state.frontmatter || ''));
      if (!data) return mapping;
      if (!data.media || typeof data.media !== 'object') data.media = {};
      let changed = false;
      Object.entries(entries).forEach(([tag, entry]) => {
        if (!entry || typeof entry !== 'object') return;
        const filename = String(entry.filename || '');
        let candidate = tag;
        let n = 1;
        while (data.media[candidate] && String(data.media[candidate].filename || '') !== filename) {
          n += 1;
          candidate = `${tag}_${n}`;
        }
        mapping[tag] = candidate;
        if (!data.media[candidate]) {
          data.media[candidate] = entry;
          changed = true;
        }
      });
      if (changed) state.frontmatter = stringifyFrontMatter(data);
      return mapping;
    },

    replaceStacks(stacks) {
      const mapped = Array.isArray(stacks)
        ? stacks.map((column) => (Array.isArray(column) ? column.map(normalizeSlide) : []))
        : [];
      state.stacks = ensureNonEmptyStacks(mapped);
      state.selected = clampSelection(state.selected);
    }
  };
}

function runTransaction(label, fn) {
  if (typeof fn !== 'function') return;
  const txLabel = String(label || '').trim();
  const beforeSelection = { h: state.selected.h, v: state.selected.v };
  const beforeStacksSnapshot = JSON.stringify(state.stacks);
  try {
    const tx = createTransaction();
    fn(tx);
    state.stacks = ensureNonEmptyStacks(state.stacks);
    state.selected = clampSelection(state.selected);
    selectSlide(state.selected.h, state.selected.v, { syncPreview: false });
    const selectionChanged =
      state.selected.h !== beforeSelection.h || state.selected.v !== beforeSelection.v;
    const stacksChanged = JSON.stringify(state.stacks) !== beforeStacksSnapshot;

    if (selectionChanged) {
      const expiresAt = Date.now() + 6000;
      state.previewExpectedSelection = { h: state.selected.h, v: state.selected.v, expiresAt };
      state.previewSelectionLockUntil = expiresAt;
    }

    if (stacksChanged) {
      markDirty();
      schedulePreviewUpdate(DEFAULT_EVENT_TIMEOUT_MS);
      return;
    }
    if (selectionChanged) {
      syncPreviewToEditor();
    }
  } catch (err) {
    if (txLabel) {
      console.error(`[builder-host] Transaction '${txLabel}' failed:`, err);
      return;
    }
    console.error('[builder-host] Transaction failed:', err);
  }
}

function ensureContainers() {
  if (hostState.containers.previewHeader) return hostState.containers;

  const previewActions = document.querySelector('.builder-preview .panel-header .panel-actions');
  if (previewActions) {
    const modeStrip = document.createElement('div');
    modeStrip.className = 'builder-extension-mode-strip builder-extension-mode-strip-preview';
    previewActions.insertBefore(modeStrip, previewActions.firstChild);
    hostState.containers.previewHeader = modeStrip;
  }

  const builderActions = document.querySelector('.builder-header .builder-actions');
  if (builderActions) {
    const leftStrip = document.createElement('div');
    leftStrip.className = 'builder-extension-mode-strip builder-extension-mode-strip-left';
    builderActions.appendChild(leftStrip);
    hostState.containers.leftHeader = leftStrip;

    const toolbarStrip = document.createElement('div');
    toolbarStrip.className = 'builder-extension-toolbar-strip';
    builderActions.appendChild(toolbarStrip);
    hostState.containers.toolbar = toolbarStrip;
  }

  hostState.containers.viewTabs = document.querySelector('.builder-header .builder-view-switch');
  hostState.containers.workspace = document.getElementById('builder-workspace');
  hostState.containers.previewBody = document.querySelector('.builder-preview .panel-body');
  hostState.containers.leftPanelsRoot = document.querySelector('.builder-left');
  return hostState.containers;
}

function createModeContext(contribution) {
  return {
    host: hostState.host,
    id: contribution.id,
    // View-tab modes get the workspace root they render into.
    root: hostState.workspaceRoots.get(contribution.id) || null,
    slug,
    mdFile,
    dir
  };
}

function applyPreviewButtonState(entry) {
  if (!entry?.button) return;
  const isActive = !!entry.active;
  entry.button.classList.toggle('is-active', isActive);
  entry.button.setAttribute('aria-pressed', String(isActive));
  if (isActive && entry.color) {
    entry.button.style.background = entry.color;
    entry.button.style.borderColor = entry.color;
    entry.button.style.color = '#fff';
    return;
  }
  entry.button.style.removeProperty('background');
  entry.button.style.removeProperty('border-color');
  entry.button.style.removeProperty('color');
}

function setPreviewButtonActive(id, active) {
  const key = String(id || '').trim();
  if (!key) return false;
  const entry = hostState.previewButtons.get(key);
  if (!entry) return false;
  const changed = entry.active !== !!active;
  entry.active = !!active;
  applyPreviewButtonState(entry);
  if (changed) {
    emit('preview-button:changed', {
      id: key,
      group: entry.group,
      active: entry.active
    });
  }
  return true;
}

function setPreviewButtonGroupActive(group, activeId = '') {
  const groupId = String(group || '').trim();
  if (!groupId) return false;
  const targetId = String(activeId || '').trim();
  let changed = false;
  hostState.previewButtons.forEach((entry, id) => {
    if (entry.group !== groupId) return;
    const next = !!targetId && id === targetId;
    if (entry.active !== next) {
      entry.active = next;
      applyPreviewButtonState(entry);
      emit('preview-button:changed', {
        id,
        group: entry.group,
        active: entry.active,
        activeId: targetId
      });
      changed = true;
    }
  });
  return changed;
}

function registerPreviewButton(contribution = {}) {
  ensureContainers();
  const id = String(contribution.id || '').trim();
  if (!id || hostState.previewButtons.has(id)) {
    return () => {};
  }

  const location = contribution.location === 'left-header' ? 'leftHeader' : 'previewHeader';
  const container = hostState.containers[location];
  if (!container) {
    return () => {};
  }

  const adoptedButton = contribution.element instanceof HTMLElement ? contribution.element : null;
  const button = adoptedButton || document.createElement('button');
  if (!adoptedButton) {
    button.type = 'button';
    button.className = 'panel-button builder-extension-preview-button';
    container.appendChild(button);
  } else {
    button.classList.add('builder-extension-preview-button');
  }
  button.dataset.previewButtonId = id;

  const title = String(contribution.title || '').trim();
  const tooltip = String(contribution.tooltip || '').trim();
  if (title) button.textContent = title;
  if (tooltip) button.title = tooltip;

  const entry = {
    id,
    button,
    group: String(contribution.group || '').trim(),
    color: String(contribution.color || '').trim(),
    active: false
  };
  hostState.previewButtons.set(id, entry);

  const onClick = typeof contribution.onClick === 'function' ? contribution.onClick : null;
  const handler = (event) => {
    if (!onClick) return;
    try {
      onClick({
        event,
        id,
        host: hostState.host,
        isActive: () => !!hostState.previewButtons.get(id)?.active,
        setActive: (next) => setPreviewButtonActive(id, !!next),
        setGroupActive: (nextId = '') => setPreviewButtonGroupActive(entry.group, nextId)
      });
    } catch (err) {
      console.warn(`[builder-host] Preview button '${id}' handler failed:`, err);
    }
  };
  button.addEventListener('click', handler);

  if (entry.group && contribution.active) {
    setPreviewButtonGroupActive(entry.group, id);
  } else {
    setPreviewButtonActive(id, !!contribution.active);
  }

  return () => {
    const current = hostState.previewButtons.get(id);
    if (!current) return;
    current.button.removeEventListener('click', handler);
    if (!adoptedButton) {
      current.button.remove();
    } else {
      current.button.classList.remove('builder-extension-preview-button');
      current.button.classList.remove('is-active');
      current.button.removeAttribute('aria-pressed');
      current.button.style.removeProperty('background');
      current.button.style.removeProperty('border-color');
      current.button.style.removeProperty('color');
    }
    hostState.previewButtons.delete(id);
  };
}

function setModeButtonState(activeId) {
  hostState.modeButtons.forEach((button, modeId) => {
    button.classList.toggle('is-active', modeId === activeId);
    button.setAttribute('aria-pressed', String(modeId === activeId));
  });
}

function deactivateMode(modeId) {
  const instance = hostState.modeInstances.get(modeId);
  if (instance && typeof instance.onDeactivate === 'function') {
    try {
      instance.onDeactivate();
    } catch (err) {
      console.warn(`[builder-host] Failed to deactivate mode '${modeId}':`, err);
    }
  }
}

// View-tab modes appear in the Visual / Markdown / Split switch and replace the
// whole builder workspace below the header while active.
function isWorkspaceMode(modeId) {
  return !!modeId && hostState.modeRegistry.get(modeId)?.location === 'view-tabs';
}

function applyWorkspaceState() {
  const activeId = hostState.activeModeId;
  const workspaceId = isWorkspaceMode(activeId) ? activeId : '';
  hostState.workspaceRoots.forEach((root, modeId) => {
    root.hidden = modeId !== workspaceId;
  });
  if (hostState.containers.workspace) {
    hostState.containers.workspace.hidden = !workspaceId;
  }
  setWorkspaceTab(workspaceId);
}

function setActiveModeState(nextId) {
  hostState.activeModeId = nextId;
  setModeButtonState(nextId);
  applyWorkspaceState();
}

function emitModeChanged(activeModeId, previousModeId) {
  emit('mode:changed', {
    activeModeId,
    previousModeId,
    workspace: isWorkspaceMode(activeModeId),
    previousWorkspace: isWorkspaceMode(previousModeId)
  });
}

function activateMode(modeId) {
  if (!hostState.modeRegistry.has(modeId)) return;
  if (hostState.activeModeId === modeId) return;
  const contribution = hostState.modeRegistry.get(modeId);
  if (!contribution) return;
  // Mount before touching the current mode, so a failed mount leaves it running.
  let instance = hostState.modeInstances.get(modeId);
  if (!instance) {
    try {
      const mounted = contribution.mount?.(createModeContext(contribution));
      instance = mounted && typeof mounted === 'object' ? mounted : {};
      hostState.modeInstances.set(modeId, instance);
    } catch (err) {
      console.error(`[builder-host] Failed to mount mode '${modeId}':`, err);
      return;
    }
  }
  const previousId = hostState.activeModeId;
  if (previousId) {
    deactivateMode(previousId);
  }
  // Show the workspace root before onActivate so the mode can measure it.
  setActiveModeState(modeId);
  if (typeof instance.onActivate === 'function') {
    try {
      instance.onActivate();
    } catch (err) {
      console.warn(`[builder-host] Failed to activate mode '${modeId}':`, err);
    }
  }
  emitModeChanged(modeId, previousId);
}

function exitActiveMode() {
  const previousId = hostState.activeModeId;
  if (!previousId) return;
  deactivateMode(previousId);
  setActiveModeState('');
  emitModeChanged('', previousId);
}

function getActiveModeId() {
  return hostState.activeModeId;
}

function hasMode(modeId) {
  const id = String(modeId || '').trim();
  if (!id) return false;
  return hostState.modeRegistry.has(id);
}

function setActiveMode(modeId) {
  const id = String(modeId || '').trim();
  if (!id) {
    exitActiveMode();
    return true;
  }
  if (!hostState.modeRegistry.has(id)) return false;
  activateMode(id);
  return true;
}

function toggleMode(id) {
  if (hostState.activeModeId === id) {
    exitActiveMode();
  } else {
    activateMode(id);
  }
}

// A tab in the view switch plus a host-owned root in the workspace container.
function createWorkspaceTab(id, contribution, label) {
  const { viewTabs, workspace } = hostState.containers;
  if (!viewTabs || !workspace) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'builder-view-tab-extension';
  button.dataset.modeId = id;
  button.textContent = contribution.icon ? `${contribution.icon} ${label}` : label;
  button.title = String(contribution.tooltip || label);
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => toggleMode(id));
  viewTabs.appendChild(button);

  const root = document.createElement('div');
  root.className = 'builder-workspace-view';
  root.dataset.modeId = id;
  root.hidden = true;
  workspace.appendChild(root);
  hostState.workspaceRoots.set(id, root);

  return {
    button,
    remove() {
      button.remove();
      root.remove();
      hostState.workspaceRoots.delete(id);
    }
  };
}

function registerMode(contribution = {}) {
  ensureContainers();
  const id = String(contribution.id || '').trim();
  const label = String(contribution.label || '').trim();
  if (!id || !label || typeof contribution.mount !== 'function') {
    return () => {};
  }
  if (hostState.modeRegistry.has(id)) {
    return () => {};
  }

  const location = ['left-header', 'view-tabs'].includes(contribution.location)
    ? contribution.location
    : 'preview-header';
  let button = null;
  let removeButton = () => {};
  if (location === 'view-tabs') {
    const tab = createWorkspaceTab(id, contribution, label);
    if (!tab) return () => {};
    button = tab.button;
    removeButton = tab.remove;
  } else {
    removeButton = registerPreviewButton({
      id: `mode:${id}`,
      location,
      title: contribution.icon ? `${contribution.icon} ${label}` : label,
      tooltip: String(contribution.tooltip || label),
      onClick: () => toggleMode(id)
    });
    button = hostState.previewButtons.get(`mode:${id}`)?.button || null;
  }

  hostState.modeRegistry.set(id, {
    ...contribution,
    location,
    exclusive: contribution.exclusive !== false
  });
  if (button) {
    button.classList.add('builder-extension-mode-button');
    button.dataset.modeId = id;
    hostState.modeButtons.set(id, button);
  }

  return () => {
    if (hostState.activeModeId === id) {
      exitActiveMode();
    }
    const instance = hostState.modeInstances.get(id);
    if (instance && typeof instance.dispose === 'function') {
      try {
        instance.dispose();
      } catch (err) {
        console.warn(`[builder-host] Failed to dispose mode '${id}':`, err);
      }
    }
    hostState.modeInstances.delete(id);
    hostState.modeRegistry.delete(id);
    removeButton();
    hostState.modeButtons.delete(id);
  };
}

function registerPanel(contribution = {}) {
  ensureContainers();
  const root = hostState.containers.leftPanelsRoot;
  const id = String(contribution.id || '').trim();
  if (!root || !id || typeof contribution.mount !== 'function') {
    return () => {};
  }
  const panel = document.createElement('section');
  panel.className = 'builder-panel builder-extension-panel';
  panel.dataset.extensionPanelId = id;
  const body = document.createElement('div');
  body.className = 'panel-body';
  panel.appendChild(body);
  root.appendChild(panel);

  let dispose = null;
  try {
    const mounted = contribution.mount({
      host: hostState.host,
      root: body,
      slug,
      mdFile,
      dir
    });
    if (typeof mounted === 'function') {
      dispose = mounted;
    } else if (mounted && typeof mounted.dispose === 'function') {
      dispose = () => mounted.dispose();
    }
  } catch (err) {
    console.error(`[builder-host] Failed to mount panel '${id}':`, err);
  }

  return () => {
    if (typeof dispose === 'function') {
      try {
        dispose();
      } catch (err) {
        console.warn(`[builder-host] Failed to dispose panel '${id}':`, err);
      }
    }
    panel.remove();
  };
}

function registerPreviewOverlay(contribution = {}) {
  ensureContainers();
  const previewBody = hostState.containers.previewBody;
  const id = String(contribution.id || '').trim();
  if (!previewBody || !id || typeof contribution.mount !== 'function') {
    return () => {};
  }
  const root = document.createElement('div');
  root.className = 'builder-extension-preview-overlay';
  root.dataset.extensionOverlayId = id;
  previewBody.appendChild(root);

  let dispose = null;
  try {
    const mounted = contribution.mount({
      host: hostState.host,
      root,
      slug,
      mdFile,
      dir
    });
    if (typeof mounted === 'function') {
      dispose = mounted;
    } else if (mounted && typeof mounted.dispose === 'function') {
      dispose = () => mounted.dispose();
    }
  } catch (err) {
    console.error(`[builder-host] Failed to mount overlay '${id}':`, err);
  }

  return () => {
    if (typeof dispose === 'function') {
      try {
        dispose();
      } catch (err) {
        console.warn(`[builder-host] Failed to dispose overlay '${id}':`, err);
      }
    }
    root.remove();
  };
}

function registerToolbarAction(action = {}) {
  ensureContainers();
  const toolbar = hostState.containers.toolbar;
  const id = String(action.id || '').trim();
  const label = String(action.label || '').trim();
  if (!toolbar || !id || !label || typeof action.onClick !== 'function') {
    return () => {};
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'panel-button builder-extension-toolbar-button';
  button.textContent = action.icon ? `${action.icon} ${label}` : label;
  button.title = label;
  button.addEventListener('click', () => {
    try {
      action.onClick({
        host: hostState.host,
        slug,
        mdFile,
        dir
      });
    } catch (err) {
      console.error(`[builder-host] Toolbar action '${id}' failed:`, err);
    }
  });
  toolbar.appendChild(button);
  return () => {
    button.remove();
  };
}

function registerKeyboardShortcut(descriptor = {}) {
  const key = String(descriptor.key || '').toLowerCase().trim();
  if (!key || typeof descriptor.onTrigger !== 'function') return () => {};
  const parts = [];
  if (descriptor.ctrl) parts.push('ctrl');
  if (descriptor.shift) parts.push('shift');
  if (descriptor.alt) parts.push('alt');
  parts.push(key);
  const registryKey = parts.join('+');
  if (!hostState.shortcutRegistry.has(registryKey)) {
    hostState.shortcutRegistry.set(registryKey, new Set());
  }
  const entry = { onTrigger: descriptor.onTrigger };
  hostState.shortcutRegistry.get(registryKey).add(entry);
  return () => {
    const set = hostState.shortcutRegistry.get(registryKey);
    if (set) {
      set.delete(entry);
      if (!set.size) hostState.shortcutRegistry.delete(registryKey);
    }
  };
}

function dispatchBuilderKeyboardShortcut(event) {
  if (!hostState.shortcutRegistry.size) return false;
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push('ctrl');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');
  parts.push(event.key.toLowerCase());
  const registryKey = parts.join('+');
  const handlers = hostState.shortcutRegistry.get(registryKey);
  if (!handlers || !handlers.size) return false;
  let handled = false;
  handlers.forEach((entry) => {
    try {
      entry.onTrigger({ host: hostState.host, slug, mdFile, dir });
      handled = true;
    } catch (err) {
      console.warn('[builder-host] Keyboard shortcut handler failed:', err);
    }
  });
  return handled;
}

function registerSlideNavigatorRenderer(renderer) {
  if (typeof renderer !== 'function') {
    return () => {};
  }
  hostState.slideNavigatorRenderer = renderer;
  return () => {
    if (hostState.slideNavigatorRenderer === renderer) {
      hostState.slideNavigatorRenderer = null;
    }
  };
}

function openDialog(spec = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'builder-extension-dialog-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:20000;display:flex;align-items:center;justify-content:center;padding:20px;';
    const card = document.createElement('div');
    card.className = 'builder-extension-dialog-card';
    card.style.cssText = 'background:#12161d;color:#fff;border:1px solid #2a2f39;border-radius:10px;min-width:320px;max-width:min(900px,95vw);max-height:90vh;overflow:auto;padding:16px;';
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const previouslyFocused = document.activeElement;
    let closed = false;
    const close = (result) => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
      resolve(result);
    };
    // Escape cancels; Tab/Shift+Tab wrap inside the card.
    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close({ canceled: true });
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(card.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((el) => el.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        card.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeydown, true);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close({ canceled: true });
    });
    const fail = (err) => {
      console.error('[builder-host] openDialog render failed:', err);
      close({ canceled: true, error: err?.message || String(err) });
    };
    card.tabIndex = -1;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    try {
      if (typeof spec.render === 'function') {
        const rendered = spec.render({
          root: card,
          close,
          host: hostState.host
        });
        if (rendered && typeof rendered.then === 'function') rendered.then(undefined, fail);
        card.focus();
        return;
      }
      if (spec.title) {
        const titleEl = document.createElement('h3');
        titleEl.textContent = String(spec.title);
        titleEl.style.margin = '0 0 10px';
        card.appendChild(titleEl);
      }
      if (spec.message) {
        const messageEl = document.createElement('div');
        messageEl.textContent = String(spec.message);
        messageEl.style.margin = '0 0 12px';
        card.appendChild(messageEl);
      }
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'panel-button';
      closeBtn.textContent = tr('Close');
      closeBtn.addEventListener('click', () => close({ canceled: false }));
      card.appendChild(closeBtn);
      closeBtn.focus();
    } catch (err) {
      fail(err);
    }
  });
}

function notify(message, level = 'info') {
  const prefix = level === 'error' ? '❌ ' : level === 'warn' ? '⚠️ ' : '';
  const text = `${prefix}${String(message || '').trim()}`;
  if (!text.trim()) return;
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](text);
  showBuilderToast(text);
}

function initBuilderExtensionsHost() {
  if (hostState.initialized && hostState.host) {
    return hostState.host;
  }
  ensureContainers();

  const host = {
    version: HOST_VERSION,
    apiVersion: HOST_API_VERSION,
    getDocument() {
      return {
        slug,
        mdFile,
        dir,
        frontmatter: String(state.frontmatter || ''),
        noteSeparator: String(state.noteSeparator || ':note:'),
        stacks: deepClone(state.stacks)
      };
    },
    getMetadata() {
      const parsed = parseFrontMatterText(String(state.frontmatter || ''));
      return parsed || {};
    },
    getSelection() {
      return { h: state.selected.h, v: state.selected.v };
    },
    getUiState() {
      return {
        columnMarkdownMode: !!state.columnMarkdownMode,
        previewReady: !!state.previewReady,
        dirty: !!state.dirty
      };
    },
    on,
    transact: runTransaction,
    registerMode,
    registerPreviewButton,
    setPreviewButtonActive,
    setPreviewButtonGroupActive,
    registerPanel,
    registerPreviewOverlay,
    registerToolbarAction,
    registerKeyboardShortcut,
    registerSlideNavigatorRenderer,
    getActiveModeId,
    setActiveMode,
    hasMode,
    getSlideNavigatorRenderer() {
      return hostState.slideNavigatorRenderer;
    },
    openDialog,
    notify,
    registerSaveGuard
  };

  hostState.host = host;
  hostState.initialized = true;
  // Picking Visual / Markdown / Split leaves any view-tab mode.
  setWorkspaceExitHandler(() => {
    if (isWorkspaceMode(hostState.activeModeId)) exitActiveMode();
  });
  window.RevelationBuilderHost = host;
  window.__revelationBuilderHostInternalEmit = emit;
  window.__revelationBuilderHostInternalRunSaveGuards = runSaveGuards;
  return host;
}

function normalizeContribution(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const kind = String(entry.kind || '').trim().toLowerCase();
  if (kind === 'mode' || kind === 'panel' || kind === 'preview-overlay' || kind === 'toolbar-action') {
    return entry;
  }
  if (kind === 'slide-navigator-renderer') {
    return entry;
  }
  if (entry.mount && entry.label) return { ...entry, kind: 'mode' };
  return null;
}

function applyContribution(host, contribution) {
  switch (contribution.kind) {
    case 'mode':
      host.registerMode(contribution);
      return true;
    case 'panel':
      host.registerPanel(contribution);
      return true;
    case 'preview-overlay':
      host.registerPreviewOverlay(contribution);
      return true;
    case 'toolbar-action':
      host.registerToolbarAction(contribution);
      return true;
    case 'slide-navigator-renderer':
      if (typeof contribution.renderTile === 'function') {
        host.registerSlideNavigatorRenderer(contribution.renderTile);
        return true;
      }
      return false;
    default:
      return false;
  }
}

async function loadBuilderExtensionsFromPlugins() {
  const host = initBuilderExtensionsHost();
  if (!window.RevelationPlugins || typeof window.RevelationPlugins !== 'object') {
    return 0;
  }
  const plugins = Object.entries(window.RevelationPlugins)
    .map(([name, plugin]) => ({ name, plugin, priority: plugin?.priority ?? 999 }))
    .sort((a, b) => a.priority - b.priority);

  let appliedCount = 0;
  for (const { name, plugin } of plugins) {
    if (typeof plugin?.getBuilderExtensions !== 'function') continue;
    try {
      const entries = await plugin.getBuilderExtensions({
        host,
        slug,
        mdFile,
        dir
      });
      if (!Array.isArray(entries)) continue;
      entries.forEach((entry) => {
        const normalized = normalizeContribution(entry);
        if (!normalized) return;
        if (applyContribution(host, normalized)) {
          appliedCount += 1;
        }
      });
    } catch (err) {
      console.error(`[builder-host] Failed to load builder extensions from plugin '${name}':`, err);
    }
  }
  if (appliedCount > 0) {
    emit('document:changed', { source: 'extensions-loaded', count: appliedCount });
  }
  return appliedCount;
}

export {
  initBuilderExtensionsHost,
  loadBuilderExtensionsFromPlugins,
  dispatchBuilderKeyboardShortcut
};
