/*
 * Builder extension host API and plugin contribution loader.
 *
 * Sections:
 * - Host bootstrap + events
 * - Transactions
 * - UI contribution registries
 * - Plugin contribution loader
 */
import {
  slug,
  mdFile,
  dir,
  state
} from './context.js';
import { sanitizeStacks, createEmptySlide } from './markdown.js';
import { markDirty } from './app-state.js';
import { selectSlide } from './slides.js';
import { schedulePreviewUpdate } from './preview.js';

const HOST_VERSION = '1.0';
const HOST_API_VERSION = 1;
const DEFAULT_EVENT_TIMEOUT_MS = 0;

const hostState = {
  initialized: false,
  host: null,
  listeners: new Map(),
  modeRegistry: new Map(),
  modeButtons: new Map(),
  modeInstances: new Map(),
  activeModeId: '',
  containers: {
    previewHeader: null,
    leftHeader: null,
    toolbar: null,
    previewBody: null,
    leftPanelsRoot: null
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

function normalizeSlide(input) {
  const slide = input && typeof input === 'object' ? input : {};
  return {
    top: String(slide.top || ''),
    body: String(slide.body || ''),
    notes: String(slide.notes || '')
  };
}

function ensureNonEmptyStacks(nextStacks) {
  const sanitized = sanitizeStacks(nextStacks);
  if (sanitized.length) return sanitized;
  return [[createEmptySlide()]];
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

    replaceColumn(h, slides) {
      const columnIndex = Number(h);
      if (!Number.isInteger(columnIndex) || columnIndex < 0) return;
      const replacement = Array.isArray(slides)
        ? slides.map(normalizeSlide).filter((slide) => slide.top || slide.body || slide.notes)
        : [];
      state.stacks[columnIndex] = replacement.length ? replacement : [createEmptySlide()];
      state.selected = clampSelection(state.selected);
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
  try {
    const tx = createTransaction();
    fn(tx);
    state.stacks = ensureNonEmptyStacks(state.stacks);
    state.selected = clampSelection(state.selected);
    selectSlide(state.selected.h, state.selected.v, { syncPreview: false });
    markDirty();
    schedulePreviewUpdate(DEFAULT_EVENT_TIMEOUT_MS);
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

  hostState.containers.previewBody = document.querySelector('.builder-preview .panel-body');
  hostState.containers.leftPanelsRoot = document.querySelector('.builder-left');
  return hostState.containers;
}

function createModeContext(contribution) {
  return {
    host: hostState.host,
    id: contribution.id,
    slug,
    mdFile,
    dir
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

function activateMode(modeId) {
  if (!hostState.modeRegistry.has(modeId)) return;
  if (hostState.activeModeId === modeId) return;
  const contribution = hostState.modeRegistry.get(modeId);
  if (!contribution) return;
  if (hostState.activeModeId) {
    deactivateMode(hostState.activeModeId);
  }
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
  if (instance && typeof instance.onActivate === 'function') {
    try {
      instance.onActivate();
    } catch (err) {
      console.warn(`[builder-host] Failed to activate mode '${modeId}':`, err);
    }
  }
  hostState.activeModeId = modeId;
  setModeButtonState(modeId);
  emit('mode:changed', { activeModeId: modeId });
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

  const location = contribution.location === 'left-header' ? 'leftHeader' : 'previewHeader';
  const container = hostState.containers[location];
  if (!container) {
    return () => {};
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'panel-button builder-extension-mode-button';
  button.textContent = contribution.icon ? `${contribution.icon} ${label}` : label;
  button.title = label;
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => {
    if (hostState.activeModeId === id) {
      deactivateMode(id);
      hostState.activeModeId = '';
      setModeButtonState('');
      emit('mode:changed', { activeModeId: '' });
      return;
    }
    activateMode(id);
  });
  container.appendChild(button);

  hostState.modeRegistry.set(id, {
    ...contribution,
    exclusive: contribution.exclusive !== false
  });
  hostState.modeButtons.set(id, button);

  return () => {
    if (hostState.activeModeId === id) {
      deactivateMode(id);
      hostState.activeModeId = '';
      emit('mode:changed', { activeModeId: '' });
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
    const btn = hostState.modeButtons.get(id);
    if (btn) btn.remove();
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

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close({ canceled: true });
    });

    try {
      if (typeof spec.render === 'function') {
        spec.render({
          root: card,
          close,
          host: hostState.host
        });
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
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', () => close({ canceled: false }));
      card.appendChild(closeBtn);
    } catch (err) {
      console.error('[builder-host] openDialog render failed:', err);
      close({ canceled: true, error: err.message });
    }
  });
}

function notify(message, level = 'info') {
  const prefix = level === 'error' ? '❌ ' : level === 'warn' ? '⚠️ ' : '';
  const text = `${prefix}${String(message || '').trim()}`;
  if (!text.trim()) return;
  if (window.__builderToast && typeof window.__builderToast === 'function') {
    window.__builderToast(text);
    return;
  }
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](text);
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
    registerPanel,
    registerPreviewOverlay,
    registerToolbarAction,
    openDialog,
    notify
  };

  hostState.host = host;
  hostState.initialized = true;
  window.RevelationBuilderHost = host;
  window.__revelationBuilderHostInternalEmit = emit;
  return host;
}

function normalizeContribution(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const kind = String(entry.kind || '').trim().toLowerCase();
  if (kind === 'mode' || kind === 'panel' || kind === 'preview-overlay' || kind === 'toolbar-action') {
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
  loadBuilderExtensionsFromPlugins
};
