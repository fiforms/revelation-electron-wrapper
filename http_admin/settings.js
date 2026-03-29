// /admin/settings.js
import { createInfoPanel } from '/js/info-panel.js';

const languageSelect = document.getElementById('language');
const preferredPresentationLanguage = document.getElementById('preferredPresentationLanguage');
const screenTypeVariant = document.getElementById('screenTypeVariant');
const displaySelect = document.getElementById('preferredDisplay');
const zoomFactorInput = document.getElementById('zoomFactor');
const vitePortInput = document.getElementById('viteServerPort');
const startupMode = document.getElementById('startupMode');
const revealRemoteInput = document.getElementById('revealRemotePublicServer');
const revealRemotePublicServerNote = document.getElementById('revealRemotePublicServerNote');
const ffmpegPath = document.getElementById('ffmpegPath');
const ffprobePath = document.getElementById('ffprobePath');
const saveButton = document.getElementById('saveBtn');
const pluginListContainer = document.getElementById('plugin-list');
const presentationsDirInput = document.getElementById('presentationsDir');
const preferHighBitrate = document.getElementById('preferHighBitrate');
const autoConvertAv1Media = document.getElementById('autoConvertAv1Media');
const mdnsBrowse = document.getElementById('mdnsBrowse');
const mdnsPublish = document.getElementById('mdnsPublish');
const mdnsInstanceName = document.getElementById('mdnsInstanceName');
const mdnsPairingPin = document.getElementById('mdnsPairingPin');
const waylandWarning = document.getElementById('waylandWarning');
const waylandStatus = document.getElementById('waylandStatus');
const updateCheckEnabled = document.getElementById('updateCheckEnabled');
const pipEnabled = document.getElementById('pipEnabled');
const pipSide = document.getElementById('pipSide');
const pipColor = document.getElementById('pipColor');
const additionalScreensList = document.getElementById('additionalScreensList');
const addAdditionalScreenBtn = document.getElementById('addAdditionalScreenBtn');
const publishUrlField = document.getElementById('publishUrlField');
const copyPublishUrlBtn = document.getElementById('copyPublishUrlBtn');
const presentationScreenMode = document.getElementById('presentationScreenMode');
const virtualPeersDefaultMode = document.getElementById('virtualPeersDefaultMode');
const virtualPeersDefaultPresentationGroup = document.getElementById('virtualPeersDefaultPresentationGroup');
const virtualPeersDefaultPresentation = document.getElementById('virtualPeersDefaultPresentation');
const settingsHelpBtn = document.getElementById('settingsHelpBtn');
const hotkeyRows = Array.from(document.querySelectorAll('.hotkey-row'));

let config = {};
let displayOptions = [];

function markDirty() {
  if (saveButton) saveButton.disabled = false;
}
let recordingAction = null;
let globalHotkeysDraft = {
  pipToggle: '',
  previous: '',
  next: '',
  blank: '',
  up: '',
  down: '',
  left: '',
  right: ''
};

const HOTKEY_ACTIONS = ['pipToggle', 'previous', 'next', 'blank', 'up', 'down', 'left', 'right'];
const HOTKEY_LABEL_KEYS = {
  pipToggle: 'PIP Toggle (sends X)',
  previous: 'Previous (sends P)',
  next: 'Next (sends Space)',
  blank: 'Blank (sends B)',
  up: 'Up Arrow',
  down: 'Down Arrow',
  left: 'Left Arrow',
  right: 'Right Arrow'
};

function t(key) {
  if (typeof window.tr === 'function') return window.tr(key);
  return key;
}

function escapeHTML(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPrivacyPolicyURL(serverURL) {
  const raw = String(serverURL || '').trim();
  if (!raw) return '';
  try {
    return new URL('/privacypolicy.html', raw).toString();
  } catch (_err) {
    return '';
  }
}

function updateRevealRemotePublicServerNote() {
  if (!revealRemotePublicServerNote) return;
  const privacyPolicyURL = buildPrivacyPolicyURL(revealRemoteInput?.value);
  const noteText = escapeHTML(t('Used for exported presentations.'));
  const privacyPolicyLabel = escapeHTML(t('Privacy Policy'));
  if (privacyPolicyURL) {
    revealRemotePublicServerNote.innerHTML = `${noteText} <a href="${escapeHTML(privacyPolicyURL)}" target="_blank" rel="noopener noreferrer">${privacyPolicyLabel}</a>`;
    return;
  }
  revealRemotePublicServerNote.textContent = t('Used for exported presentations.');
}

function applySettingsLocalizations() {
  if (publishUrlField) publishUrlField.placeholder = t('Add a URL Publish screen to enable this link');
  if (virtualPeersDefaultPresentation) virtualPeersDefaultPresentation.placeholder = t('slug/presentation.md');
  document.querySelectorAll('.hotkey-input').forEach((input) => {
    input.placeholder = t('Not set');
  });
  updateRevealRemotePublicServerNote();
}

function docsKeyToPresentationFile(key) {
  const base = String(key || '')
    .replace(/\.md$/i, '')
    .replace(/[\\/]+/g, '--')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `${base || 'doc'}.md`;
}

function openDocsHandout(mdFile) {
  const file = String(mdFile || '').trim();
  if (!file) return;
  if (window.electronAPI?.openHandoutView) {
    window.electronAPI.openHandoutView('readme', file);
    return;
  }
  const host = String(config?.hostURL || 'localhost').trim();
  const port = Number.parseInt(config?.viteServerPort, 10);
  const key = String(config?.key || '').trim();
  if (!host || !Number.isFinite(port) || !key) return;
  const url = `http://${host}:${port}/presentations_${encodeURIComponent(key)}/readme/handout?p=${encodeURIComponent(file)}`;
  if (window.electronAPI?.openExternalURL) {
    window.electronAPI.openExternalURL(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

function updateVirtualPeerDefaultFields() {
  const mode = String(virtualPeersDefaultMode?.value || 'black').trim().toLowerCase();
  const showPresentation = mode === 'presentation';
  virtualPeersDefaultPresentationGroup?.classList.toggle('hidden', !showPresentation);
}

function normalizeVirtualPeerDefaultMode(mode) {
  const value = String(mode || 'black').trim().toLowerCase();
  if (value === 'green' || value === 'presentation') return value;
  return 'black';
}

function normalizePresentationScreenMode(mode, fallbackBoolean = null) {
  const value = String(mode || '').trim().toLowerCase();
  if (['always-open', 'group-control', 'on-demand'].includes(value)) return value;
  if (typeof fallbackBoolean === 'boolean') {
    return fallbackBoolean ? 'group-control' : 'on-demand';
  }
  return 'group-control';
}

function parseBooleanLike(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return !!fallback;
}

function normalizeZoomFactor(value, fallback = 1) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(3, Math.max(0.5, parsed));
}

function formatPluginFieldValue(fieldType, value, fallbackValue) {
  if (fieldType === 'json') {
    const source = value === undefined ? fallbackValue : value;
    try {
      return JSON.stringify(source ?? null, null, 2);
    } catch {
      return JSON.stringify(fallbackValue ?? null, null, 2);
    }
  }
  if (fieldType === 'number') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return String(parsed);
    const fallbackParsed = Number(fallbackValue);
    return Number.isFinite(fallbackParsed) ? String(fallbackParsed) : '';
  }
  return value == null ? '' : String(value);
}

function parsePluginFieldValue(fieldType, rawValue, fallbackValue) {
  if (fieldType === 'boolean') {
    return parseBooleanLike(rawValue, parseBooleanLike(fallbackValue, false));
  }
  if (fieldType === 'number') {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) return parsed;
    const fallbackParsed = Number(fallbackValue);
    return Number.isFinite(fallbackParsed) ? fallbackParsed : 0;
  }
  if (fieldType === 'json') {
    const source = String(rawValue ?? '').trim();
    if (!source) {
      return fallbackValue ?? null;
    }
    return JSON.parse(source);
  }
  return rawValue;
}

function getPluginFieldCurrentValue(plugin, field) {
  const hasValue = Object.prototype.hasOwnProperty.call(plugin?.config || {}, field.name);
  if (hasValue) return plugin.config[field.name];
  return field.default;
}

function normalizeAdditionalScreen(entry = {}) {
  const target = entry.target === 'display' ? 'display' : (entry.target === 'publish' ? 'publish' : 'window');
  const parsedIndex = Number.parseInt(entry.displayIndex, 10);
  const displayIndex = Number.isFinite(parsedIndex) && parsedIndex >= 0 ? parsedIndex : null;
  const language = typeof entry.language === 'string' ? entry.language.trim().toLowerCase() : '';
  const variant = typeof entry.variant === 'string' ? entry.variant.trim().toLowerCase() : '';
  const rawDefaultMode = typeof entry.defaultMode === 'string' ? entry.defaultMode.trim().toLowerCase() : '';
  const defaultMode = ['black', 'green', 'presentation'].includes(rawDefaultMode) ? rawDefaultMode : '';
  const defaultPresentation = typeof entry.defaultPresentation === 'string' ? entry.defaultPresentation.trim() : '';
  if (target === 'display' && displayIndex === null) {
    return null;
  }
  return { target, displayIndex, language, variant, defaultMode, defaultPresentation };
}

function getPublishUrlFromConfig() {
  const key = String(config?.presentationPublishKey || '').trim();
  const host = String(config?.hostLANURL || config?.hostURL || '').trim();
  const port = Number.parseInt(config?.viteServerPort, 10);
  if (!key || !host || !Number.isFinite(port)) return '';
  const hasPublishTarget = readAdditionalScreensFromForm().some((entry) => entry?.target === 'publish');
  if (!hasPublishTarget) return '';
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeKey) return '';
  return `http://${host}:${port}/publish/${safeKey}.html`;
}

function refreshPublishUrlField() {
  if (!publishUrlField || !copyPublishUrlBtn) return;
  const url = getPublishUrlFromConfig();
  publishUrlField.value = url;
  copyPublishUrlBtn.disabled = !url;
}

function updateAdditionalScreenDefaultFields(row) {
  if (!row) return;
  const mode = String(row.querySelector('.additional-screen-default-mode')?.value || '').trim().toLowerCase();
  const wrapper = row.querySelector('.additional-screen-default-presentation-wrapper');
  if (!wrapper) return;
  wrapper.classList.toggle('hidden', mode !== 'presentation');
}

function getVariantOptions() {
  return [
    { value: '', label: t('Normal') },
    { value: 'lowerthirds', label: t('Lower Thirds') },
    { value: 'confidencemonitor', label: t('Confidence Monitor') },
    { value: 'notes', label: t('Notes') }
  ];
}

function renderAdditionalScreens(additionalScreens = []) {
  additionalScreensList.innerHTML = '';
  const rows = Array.isArray(additionalScreens) ? additionalScreens : [];
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'additional-screens-empty';
    empty.textContent = t('No additional screens configured.');
    additionalScreensList.appendChild(empty);
    return;
  }
  rows.forEach((entry) => addAdditionalScreenRow(entry));
}

function addAdditionalScreenRow(entry = {}) {
  const normalized = normalizeAdditionalScreen(entry) || {
    target: 'window',
    displayIndex: null,
    language: '',
    variant: '',
    defaultMode: '',
    defaultPresentation: ''
  };
  const row = document.createElement('div');
  row.className = 'additional-screen-row';

  const targetWrapper = document.createElement('div');
  const targetLabel = document.createElement('label');
  targetLabel.textContent = t('Screen');
  const targetSelect = document.createElement('select');
  targetSelect.className = 'additional-screen-target';
  const windowOption = document.createElement('option');
  windowOption.value = 'window';
  windowOption.textContent = t('Window only');
  targetSelect.appendChild(windowOption);
  const publishOption = document.createElement('option');
  publishOption.value = 'publish';
  publishOption.textContent = t('URL Publish');
  targetSelect.appendChild(publishOption);
  displayOptions.forEach((opt) => {
    const displayOption = document.createElement('option');
    displayOption.value = `display:${opt.index}`;
    displayOption.textContent = opt.label;
    targetSelect.appendChild(displayOption);
  });
  targetSelect.value = normalized.target === 'display'
    ? `display:${normalized.displayIndex}`
    : (normalized.target === 'publish' ? 'publish' : 'window');
  targetWrapper.appendChild(targetLabel);
  targetWrapper.appendChild(targetSelect);

  const langWrapper = document.createElement('div');
  const langLabel = document.createElement('label');
  langLabel.textContent = t('Language');
  const langInput = document.createElement('input');
  langInput.className = 'additional-screen-language';
  langInput.maxLength = 8;
  langInput.placeholder = t('default');
  langInput.value = normalized.language || '';
  langWrapper.appendChild(langLabel);
  langWrapper.appendChild(langInput);

  const variantWrapper = document.createElement('div');
  const variantLabel = document.createElement('label');
  variantLabel.textContent = t('Variant');
  const variantSelect = document.createElement('select');
  variantSelect.className = 'additional-screen-variant';
  getVariantOptions().forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    variantSelect.appendChild(option);
  });
  variantSelect.value = normalized.variant || '';
  variantWrapper.appendChild(variantLabel);
  variantWrapper.appendChild(variantSelect);

  const defaultModeWrapper = document.createElement('div');
  const defaultModeLabel = document.createElement('label');
  defaultModeLabel.textContent = t('Default Screen');
  const defaultModeSelect = document.createElement('select');
  defaultModeSelect.className = 'additional-screen-default-mode';
  [
    { value: '', label: t('Use Main Default') },
    { value: 'black', label: t('Solid Black') },
    { value: 'green', label: t('Solid Green') },
    { value: 'presentation', label: t('Default Presentation') }
  ].forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    defaultModeSelect.appendChild(option);
  });
  defaultModeSelect.value = normalized.defaultMode || '';
  defaultModeWrapper.appendChild(defaultModeLabel);
  defaultModeWrapper.appendChild(defaultModeSelect);

  const defaultPresentationWrapper = document.createElement('div');
  defaultPresentationWrapper.className = 'additional-screen-default-presentation-wrapper';
  const defaultPresentationLabel = document.createElement('label');
  defaultPresentationLabel.textContent = t('Default Pres Path');
  const defaultPresentationInput = document.createElement('input');
  defaultPresentationInput.className = 'additional-screen-default-presentation';
  defaultPresentationInput.placeholder = t('slug/presentation.md');
  defaultPresentationInput.value = normalized.defaultPresentation || '';
  defaultPresentationWrapper.appendChild(defaultPresentationLabel);
  defaultPresentationWrapper.appendChild(defaultPresentationInput);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'additional-screen-remove';
  removeBtn.textContent = t('Remove');
  removeBtn.addEventListener('click', () => {
    row.remove();
    if (!additionalScreensList.children.length) {
      renderAdditionalScreens([]);
    }
    refreshPublishUrlField();
    markDirty();
  });

  row.appendChild(targetWrapper);
  row.appendChild(langWrapper);
  row.appendChild(variantWrapper);
  row.appendChild(defaultModeWrapper);
  row.appendChild(defaultPresentationWrapper);
  row.appendChild(removeBtn);
  defaultModeSelect.addEventListener('change', () => updateAdditionalScreenDefaultFields(row));
  targetSelect.addEventListener('change', refreshPublishUrlField);
  updateAdditionalScreenDefaultFields(row);

  const emptyState = additionalScreensList.querySelector('.additional-screens-empty');
  if (emptyState) emptyState.remove();
  additionalScreensList.appendChild(row);
}

function readAdditionalScreensFromForm() {
  const rows = Array.from(additionalScreensList.querySelectorAll('.additional-screen-row'));
  return rows
    .map((row) => {
      const targetValue = row.querySelector('.additional-screen-target')?.value || 'window';
      const language = (row.querySelector('.additional-screen-language')?.value || '').trim().toLowerCase();
      const variant = (row.querySelector('.additional-screen-variant')?.value || '').trim().toLowerCase();
      const rawDefaultMode = (row.querySelector('.additional-screen-default-mode')?.value || '').trim().toLowerCase();
      const defaultMode = ['black', 'green', 'presentation'].includes(rawDefaultMode) ? rawDefaultMode : '';
      const defaultPresentation = (row.querySelector('.additional-screen-default-presentation')?.value || '').trim();
      if (targetValue === 'window') {
        return normalizeAdditionalScreen({
          target: 'window',
          displayIndex: null,
          language,
          variant,
          defaultMode,
          defaultPresentation
        });
      }
      if (targetValue === 'publish') {
        return normalizeAdditionalScreen({
          target: 'publish',
          displayIndex: null,
          language,
          variant,
          defaultMode,
          defaultPresentation
        });
      }
      if (!targetValue.startsWith('display:')) return null;
      const displayIndex = Number.parseInt(targetValue.split(':')[1], 10);
      return normalizeAdditionalScreen({
        target: 'display',
        displayIndex,
        language,
        variant,
        defaultMode,
        defaultPresentation
      });
    })
    .filter(Boolean);
}

function normalizeAccelerator(accelerator) {
  if (typeof accelerator !== 'string') return '';
  return accelerator.trim();
}

function getHotkeyRow(action) {
  return hotkeyRows.find((row) => row.dataset.hotkeyAction === action) || null;
}

function setHotkeyInputValue(action, value) {
  const row = getHotkeyRow(action);
  if (!row) return;
  const input = row.querySelector('.hotkey-input');
  if (!input) return;
  input.value = value || '';
}

function renderHotkeyRows() {
  HOTKEY_ACTIONS.forEach((action) => {
    setHotkeyInputValue(action, globalHotkeysDraft[action] || '');
  });
}

function eventToAccelerator(event) {
  if (!event) return '';
  const key = String(event.key || '');
  const code = String(event.code || '');
  if (!key && !code) return '';

  const ignored = new Set(['control', 'shift', 'alt', 'meta']);
  if (ignored.has(key.toLowerCase())) return '';

  const parts = [];
  if (event.ctrlKey) parts.push('CommandOrControl');
  if (event.metaKey) parts.push('Super');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  let base = '';
  if (code.startsWith('Key') && code.length === 4) {
    base = code.slice(3).toUpperCase();
  } else if (code.startsWith('Digit') && code.length === 6) {
    base = code.slice(5);
  } else if (code.startsWith('Numpad')) {
    const np = code.slice(6);
    const map = {
      Add: 'numadd',
      Subtract: 'numsub',
      Multiply: 'nummult',
      Divide: 'numdiv',
      Decimal: 'numdec',
      Enter: 'numenter'
    };
    base = map[np] || `num${np}`;
  } else {
    const keyMap = {
      ' ': 'Space',
      Spacebar: 'Space',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      Escape: 'Esc',
      Enter: 'Enter',
      Tab: 'Tab',
      Backspace: 'Backspace',
      Delete: 'Delete',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      Insert: 'Insert'
    };
    if (keyMap[key]) {
      base = keyMap[key];
    } else if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key)) {
      base = key.toUpperCase();
    } else if (key.length === 1) {
      base = key.toUpperCase();
    } else {
      base = key;
    }
  }

  if (!base) return '';
  parts.push(base);
  return parts.join('+');
}

function startRecordingHotkey(action, btn) {
  recordingAction = action;
  hotkeyRows.forEach((row) => {
    const actionId = row.dataset.hotkeyAction;
    const recordBtn = row.querySelector('.hotkey-record');
    if (!recordBtn) return;
    const isActive = actionId === action;
    recordBtn.classList.toggle('recording', isActive);
    recordBtn.textContent = isActive ? t('Press keys...') : t('Record');
  });
  btn?.focus();
}

function stopRecordingHotkey() {
  recordingAction = null;
  hotkeyRows.forEach((row) => {
    const recordBtn = row.querySelector('.hotkey-record');
    if (!recordBtn) return;
    recordBtn.classList.remove('recording');
    recordBtn.textContent = t('Record');
  });
}

function readHotkeysFromForm() {
  const values = {};
  HOTKEY_ACTIONS.forEach((action) => {
    values[action] = normalizeAccelerator(globalHotkeysDraft[action] || '');
  });
  return values;
}

function hasDuplicateHotkeys(hotkeys) {
  const used = new Map();
  for (const action of HOTKEY_ACTIONS) {
    const value = normalizeAccelerator(hotkeys[action] || '');
    if (!value) continue;
    if (used.has(value)) {
      return { duplicate: value, actionA: used.get(value), actionB: action };
    }
    used.set(value, action);
  }
  return null;
}

function bindHotkeyRecording() {
  hotkeyRows.forEach((row) => {
    const action = row.dataset.hotkeyAction;
    const recordBtn = row.querySelector('.hotkey-record');
    const clearBtn = row.querySelector('.hotkey-clear');
    recordBtn?.addEventListener('click', () => {
      if (recordingAction === action) {
        stopRecordingHotkey();
        return;
      }
      startRecordingHotkey(action, recordBtn);
    });
    clearBtn?.addEventListener('click', () => {
      globalHotkeysDraft[action] = '';
      setHotkeyInputValue(action, '');
      if (recordingAction === action) {
        stopRecordingHotkey();
      }
      markDirty();
    });
  });

  document.addEventListener('keydown', (event) => {
    if (!recordingAction) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      stopRecordingHotkey();
      return;
    }
    const accelerator = eventToAccelerator(event);
    if (!accelerator) return;
    globalHotkeysDraft[recordingAction] = accelerator;
    setHotkeyInputValue(recordingAction, accelerator);
    stopRecordingHotkey();
    markDirty();
  }, true);
}

async function loadSettings() {
  config = await window.electronAPI.getAppConfig();
  const screens = await window.electronAPI.getDisplayList();
  const runtimeInfo = await window.electronAPI.getRuntimeInfo();
  displayOptions = [];

  screens.forEach((screen, index) => {
    const opt = document.createElement('option');
    opt.value = index;
    opt.textContent = `Display ${index + 1}: ${screen.bounds.width}x${screen.bounds.height}`;
    if (index === config.preferredDisplay) opt.selected = true;
    displaySelect.appendChild(opt);
    displayOptions.push({
      index,
      label: `Display ${index + 1}: ${screen.bounds.width}x${screen.bounds.height}`
    });
  });

  vitePortInput.value = config.viteServerPort;
  revealRemoteInput.value = config.revealRemotePublicServer;
  updateRevealRemotePublicServerNote();
  ffmpegPath.value = config.ffmpegPath;
  ffprobePath.value = config.ffprobePath;
  startupMode.value = config.mode;
  mdnsBrowse.checked = config.mdnsBrowse !== false;
  mdnsPublish.checked = config.mdnsPublish === true;
  mdnsInstanceName.value = config.mdnsInstanceName || '';
  mdnsPairingPin.value = config.mdnsPairingPin || '';
  presentationsDirInput.value = config.presentationsDir || '';
  preferHighBitrate.checked = config.preferHighBitrate || false;
  autoConvertAv1Media.checked = config.autoConvertAv1Media || false;
  languageSelect.value = config.language || 'en';
  preferredPresentationLanguage.value = config.preferredPresentationLanguage || '';
  screenTypeVariant.value = config.screenTypeVariant || '';
  updateCheckEnabled.checked = config.updateCheckEnabled !== false;
  pipEnabled.checked = config.pipEnabled || false;
  pipSide.value = config.pipSide || 'left';
  pipColor.value = config.pipColor || '#00ff00';
  zoomFactorInput.value = normalizeZoomFactor(config.zoomFactor, 1).toFixed(2);
  globalHotkeysDraft = {
    ...globalHotkeysDraft,
    ...(config.globalHotkeys || {})
  };
  renderHotkeyRows();
  renderAdditionalScreens(config.additionalScreens || []);
  refreshPublishUrlField();
  presentationScreenMode.value = normalizePresentationScreenMode(config.presentationScreenMode, config.virtualPeersAlwaysOpen);
  virtualPeersDefaultMode.value = normalizeVirtualPeerDefaultMode(config.virtualPeersDefaultMode);
  virtualPeersDefaultPresentation.value = config.virtualPeersDefaultPresentation || '';
  updateVirtualPeerDefaultFields();

  const isWayland = runtimeInfo?.sessionType === 'wayland';
  const hasOzoneX11 = !!runtimeInfo?.hasOzoneX11;
  if (isWayland && hasOzoneX11) {
    waylandStatus.classList.remove('hidden');
    waylandWarning.classList.add('hidden');
  } else if (isWayland && !hasOzoneX11) {
    waylandWarning.classList.remove('hidden');
    waylandStatus.classList.add('hidden');
  } else {
    waylandWarning.classList.add('hidden');
    waylandStatus.classList.add('hidden');
  }

  document.getElementById('browsePresentationsDir').addEventListener('click', async () => {
    const newPath = await window.electronAPI.selectPresentationsDir();
    if (newPath) {
      presentationsDirInput.value = newPath;
      markDirty();
    }
  });

  await renderPluginList(config.allPluginFolders || []);

}

async function renderPluginList(allPlugins) {
  const enabledPlugins = await window.electronAPI.getPluginList(true);
  const allManifests = await window.electronAPI.getAllPluginManifests();
  pluginListContainer.innerHTML = '';

  const pluginConfigDraft = {};
  let openItem = null; // currently expanded accordion item

  function toggleAccordion(wrapper) {
    const isOpen = wrapper.classList.contains('open');
    if (openItem && openItem !== wrapper) {
      openItem.classList.remove('open');
    }
    wrapper.classList.toggle('open', !isOpen);
    openItem = isOpen ? null : wrapper;
  }

  allPlugins.forEach(pluginName => {
    const id = `plugin-${pluginName}`;
    const plugin = enabledPlugins[pluginName];
    const manifest = allManifests[pluginName] || {};

    // ── Wrapper ──
    const wrapper = document.createElement('div');
    wrapper.className = 'plugin-item';

    // ── Accordion header (one-liner) ──
    const header = document.createElement('div');
    header.className = 'plugin-accordion-header';

    const toggle = document.createElement('span');
    toggle.className = 'plugin-toggle';
    toggle.textContent = '▶';
    header.appendChild(toggle);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.name = pluginName;
    checkbox.className = 'plugin-enable-checkbox';
    checkbox.checked = !!plugin;
    checkbox.addEventListener('click', e => e.stopPropagation());
    header.appendChild(checkbox);

    const label = document.createElement('label');
    // No htmlFor — clicking the title only works the accordion, not the checkbox
    const nameSpan = document.createElement('span');
    nameSpan.textContent = manifest.title || pluginName;
    const versionSpan = document.createElement('span');
    const displayVersion = manifest.plugin_version || plugin?.version;
    versionSpan.textContent = displayVersion ? ` v${displayVersion}` : '';
    versionSpan.className = 'version';
    label.appendChild(nameSpan);
    label.appendChild(versionSpan);
    header.appendChild(label);

    const statusDot = document.createElement('span');
    statusDot.className = 'plugin-status-dot' + (checkbox.checked ? ' enabled' : '');
    header.appendChild(statusDot);

    header.addEventListener('click', () => toggleAccordion(wrapper));
    wrapper.appendChild(header);

    // ── Accordion body ──
    const body = document.createElement('div');
    body.className = 'plugin-accordion-body';

    // Doc button
    const docButton = document.createElement('button');
    docButton.type = 'button';
    docButton.className = 'plugin-doc-button';
    docButton.textContent = '❔ Open Documentation';
    docButton.title = `Open docs for ${pluginName}`;
    docButton.addEventListener('click', () => {
      openDocsHandout(docsKeyToPresentationFile(`plugins/${pluginName}/README.md`));
    });
    body.appendChild(docButton);

    // Meta: description / author / webpage
    if (manifest.description || manifest.author || manifest.webpage) {
      const metaRow = document.createElement('div');
      metaRow.className = 'plugin-meta';
      if (manifest.description) {
        const desc = document.createElement('p');
        desc.className = 'plugin-description';
        desc.textContent = manifest.description;
        metaRow.appendChild(desc);
      }
      if (manifest.author || manifest.webpage) {
        const authorLine = document.createElement('p');
        authorLine.className = 'plugin-author-line';
        if (manifest.author) {
          authorLine.appendChild(document.createTextNode(manifest.author));
        }
        if (manifest.webpage) {
          if (manifest.author) authorLine.appendChild(document.createTextNode(' · '));
          const link = document.createElement('a');
          link.href = '#';
          link.textContent = manifest.webpage;
          link.addEventListener('click', (e) => {
            e.preventDefault();
            window.electronAPI.openExternalURL(manifest.webpage);
          });
          authorLine.appendChild(link);
        }
        metaRow.appendChild(authorLine);
      }
      body.appendChild(metaRow);
    }

    // Config fields (only when enabled)
    const settingsContainer = document.createElement('fieldset');
    const hasFields = plugin?.configTemplate &&
      Array.isArray(plugin.configTemplate) &&
      plugin.configTemplate.length > 0;

    if (hasFields) {
      settingsContainer.className = 'plugin-settings-fields';
      settingsContainer.style.display = checkbox.checked ? 'block' : 'none';
      pluginConfigDraft[pluginName] = { ...plugin.config };

      plugin.configTemplate.forEach(field => {
        const fieldWrapper = document.createElement('div');
        fieldWrapper.style.marginBottom = '0.8em';

        const fieldLabel = document.createElement('label');
        fieldLabel.textContent = field.description || field.name;
        fieldLabel.htmlFor = `${pluginName}-${field.name}`;
        fieldLabel.style.display = 'block';
        fieldLabel.style.marginBottom = '0.2em';

        let input;
        const fieldType = String(field.type || 'string').trim().toLowerCase();
        const fieldValue = getPluginFieldCurrentValue(plugin, field);

        if (field.ui === 'dropdown' && Array.isArray(field.dropdownOptions)) {
          input = document.createElement('select');
          field.dropdownOptions.forEach(opt => {
            const optEl = document.createElement('option');
            optEl.value = opt;
            optEl.textContent = opt;
            input.appendChild(optEl);
          });
          input.value = (fieldValue ?? '').toString();
        } else if (fieldType === 'boolean') {
          input = document.createElement('input');
          input.type = 'checkbox';
          input.checked = parseBooleanLike(fieldValue, parseBooleanLike(field.default, false));
          input.style.width = 'auto';
        } else if (fieldType === 'json') {
          input = document.createElement('textarea');
          input.rows = 8;
          input.value = formatPluginFieldValue(fieldType, fieldValue, field.default);
        } else {
          input = document.createElement('input');
          input.type = fieldType === 'number' ? 'number' : 'text';
          input.value = formatPluginFieldValue(fieldType, fieldValue, field.default);
        }

        input.id = `${pluginName}-${field.name}`;
        input.name = field.name;
        if (input.type !== 'checkbox') input.style.width = '100%';

        const syncPluginFieldDraft = () => {
          try {
            pluginConfigDraft[pluginName][field.name] = parsePluginFieldValue(
              fieldType,
              input.type === 'checkbox' ? input.checked : input.value,
              field.default
            );
            input.dataset.invalid = 'false';
            input.removeAttribute('title');
          } catch (err) {
            input.dataset.invalid = 'true';
            input.title = err?.message || 'Invalid value';
          }
        };

        input.addEventListener('change', syncPluginFieldDraft);
        if (fieldType === 'json') input.addEventListener('input', syncPluginFieldDraft);
        syncPluginFieldDraft();

        fieldWrapper.appendChild(fieldLabel);
        fieldWrapper.appendChild(input);
        settingsContainer.appendChild(fieldWrapper);
      });
    } else {
      settingsContainer.style.display = 'none';
    }

    body.appendChild(settingsContainer);

    // Pending-enable notice (shown when a previously-disabled plugin is just checked)
    const pendingEnableMsg = document.createElement('p');
    pendingEnableMsg.className = 'plugin-pending-enable';
    pendingEnableMsg.textContent = 'Save settings to enable this plugin and show its settings.';
    pendingEnableMsg.style.display = 'none';
    body.appendChild(pendingEnableMsg);

    wrapper.appendChild(body);

    // Checkbox change: update dot, pending message, and settings visibility
    checkbox.addEventListener('change', () => {
      statusDot.className = 'plugin-status-dot' + (checkbox.checked ? ' enabled' : '');
      if (hasFields) {
        settingsContainer.style.display = checkbox.checked ? 'block' : 'none';
      }
      // Show pending notice when enabling a plugin that wasn't previously loaded
      if (!plugin) {
        pendingEnableMsg.style.display = checkbox.checked ? 'block' : 'none';
      }
    });

    pluginListContainer.appendChild(wrapper);
  });

  window.pluginConfigDraft = pluginConfigDraft;
}

async function saveSettings() {
  const invalidPluginField = document.querySelector('#plugin-list [data-invalid="true"]');
  if (invalidPluginField) {
    invalidPluginField.focus();
    window.alert(t('One or more plugin settings contain invalid values. Please fix them before saving.'));
    return;
  }

  const instanceNameValue = mdnsInstanceName.value.trim();
  const pinValue = mdnsPairingPin.value.trim();
  const updated = {
    preferredDisplay: parseInt(displaySelect.value),
    language: languageSelect.value,
    preferredPresentationLanguage: preferredPresentationLanguage.value.trim().toLowerCase(),
    screenTypeVariant: screenTypeVariant.value.trim().toLowerCase(),
    zoomFactor: normalizeZoomFactor(zoomFactorInput.value, normalizeZoomFactor(config.zoomFactor, 1)),
    updateCheckEnabled: updateCheckEnabled.checked,
    viteServerPort: parseInt(vitePortInput.value),
    presentationsDir: presentationsDirInput.value.trim(),
    preferHighBitrate: preferHighBitrate.checked,
    autoConvertAv1Media: autoConvertAv1Media.checked,
    ffmpegPath: ffmpegPath.value,
    ffprobePath: ffprobePath.value,
    mode: startupMode.value,
    mdnsBrowse: mdnsBrowse.checked,
    mdnsPublish: mdnsPublish.checked,
    pipEnabled: pipEnabled.checked,
    pipSide: pipSide.value,
    pipColor: pipColor.value,
    globalHotkeys: readHotkeysFromForm(),
    additionalScreens: readAdditionalScreensFromForm(),
    presentationScreenMode: normalizePresentationScreenMode(presentationScreenMode.value),
    virtualPeersDefaultMode: normalizeVirtualPeerDefaultMode(virtualPeersDefaultMode.value),
    virtualPeersDefaultPresentation: virtualPeersDefaultPresentation.value.trim(),
    mdnsInstanceName: instanceNameValue ? instanceNameValue : config.mdnsInstanceName,
    mdnsPairingPin: pinValue || config.mdnsPairingPin || '',
    plugins: Array.from(document.querySelectorAll('#plugin-list input[type="checkbox"]'))
              .filter(el => el.classList.contains('plugin-enable-checkbox'))
              .filter(el => el.checked)
              .map(el => el.name),
    revealRemotePublicServer: revealRemoteInput.value,
    pluginConfigs: window.pluginConfigDraft || {}
  };

  const dup = hasDuplicateHotkeys(updated.globalHotkeys);
  if (dup) {
    const message = t('Duplicate hotkey "{duplicate}" is assigned to both "{actionA}" and "{actionB}".')
      .replace('{duplicate}', dup.duplicate)
      .replace('{actionA}', t(HOTKEY_LABEL_KEYS[dup.actionA] || dup.actionA))
      .replace('{actionB}', t(HOTKEY_LABEL_KEYS[dup.actionB] || dup.actionB));
    window.alert(message);
    return;
  }

  await window.electronAPI.saveAppConfig(updated);

  const previousLanguage = String(config.language || 'en').trim().toLowerCase() || 'en';
  const nextLanguage = String(updated.language || 'en').trim().toLowerCase() || 'en';
  if (previousLanguage !== nextLanguage) {
    await window.electronAPI.relaunchApp();
    return;
  }

  await window.electronAPI.reloadServers();
  window.close();
}

saveButton.addEventListener('click', saveSettings);
revealRemoteInput?.addEventListener('input', updateRevealRemotePublicServerNote);
settingsHelpBtn?.addEventListener('click', () => {
  const settingsDocFile = docsKeyToPresentationFile('doc/SETTINGS.md');
  openDocsHandout(settingsDocFile);
});
addAdditionalScreenBtn.addEventListener('click', () => { addAdditionalScreenRow({}); markDirty(); });
copyPublishUrlBtn?.addEventListener('click', async () => {
  const url = getPublishUrlFromConfig();
  if (!url) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    copyPublishUrlBtn.textContent = t('Copied');
    setTimeout(() => {
      copyPublishUrlBtn.textContent = t('Copy URL');
    }, 1200);
  } catch {
    window.alert(url);
  }
});
virtualPeersDefaultMode.addEventListener('change', updateVirtualPeerDefaultFields);
bindHotkeyRecording();

// ─── Peer Pairing Tab ───────────────────────────────────────────────────────

const peeringPeerList       = document.getElementById('peering-peer-list');
const peeringPairedList     = document.getElementById('peering-paired-list');
const peeringNoPeers        = document.getElementById('peering-no-peers');
const peeringNoPaired       = document.getElementById('peering-no-paired');
const peeringStatusEl       = document.getElementById('peering-status');
const peeringPairIpInput    = document.getElementById('peering-pair-ip');
const peeringPairPortInput  = document.getElementById('peering-pair-port');
const peeringPairNatInput   = document.getElementById('peering-pair-nat');
const peeringPairIpBtn      = document.getElementById('peering-pair-ip-btn');
const peeringManualToggle   = document.getElementById('peering-manual-toggle');
const peeringManualSection  = document.getElementById('peering-manual-section');
const peeringContentWrapper = document.getElementById('peering-content-wrapper');
const peeringDisabledBanner = document.getElementById('peering-follower-disabled');
const pinModalOverlay       = document.getElementById('pinModalOverlay');
const pinModalInput         = document.getElementById('pinModalInput');
const pinModalError         = document.getElementById('pinModalError');
const pinModalCancel        = document.getElementById('pinModalCancel');
const pinModalConfirm       = document.getElementById('pinModalConfirm');

let peeringFollowerEnabled = true;
let peeringInitialized = false;

function setPeeringStatus(message, isError = false) {
  if (!peeringStatusEl) return;
  peeringStatusEl.textContent = message;
  peeringStatusEl.style.color = isError ? '#ff9b9b' : '#9bdcff';
}

function setPeeringFollowerEnabled(enabled) {
  peeringFollowerEnabled = enabled !== false;
  if (peeringContentWrapper) {
    peeringContentWrapper.classList.toggle('is-disabled', !peeringFollowerEnabled);
  }
  if (peeringDisabledBanner) {
    peeringDisabledBanner.classList.toggle('is-hidden', peeringFollowerEnabled);
  }
}

async function initializePeeringFollowerMode() {
  if (!window.electronAPI?.getAppConfig) {
    setPeeringFollowerEnabled(true);
    return true;
  }
  try {
    const appConfig = await window.electronAPI.getAppConfig();
    const enabled = appConfig?.mdnsBrowse !== false;
    setPeeringFollowerEnabled(enabled);
    return enabled;
  } catch (err) {
    console.error('Failed to load app config for peering mode:', err);
    setPeeringFollowerEnabled(true);
    return true;
  }
}

async function refreshPeeringFollowerMode() {
  const wasEnabled = peeringFollowerEnabled;
  const enabled = await initializePeeringFollowerMode();
  if (enabled && !wasEnabled && !peeringInitialized) {
    const masters = await refreshPeeringPaired();
    const peers = await window.electronAPI.getMdnsPeers();
    renderPeeringPeers(peers, masters);
    peeringInitialized = true;
  }
  if (!enabled) {
    peeringInitialized = false;
  }
  return enabled;
}

function requestPeeringPin() {
  return new Promise((resolve) => {
    if (!pinModalOverlay || !pinModalInput || !pinModalError || !pinModalCancel || !pinModalConfirm) {
      const pin = window.prompt('Enter pairing PIN');
      resolve(pin ? pin.trim() : null);
      return;
    }

    const cleanup = (result) => {
      pinModalOverlay.style.display = 'none';
      pinModalError.textContent = '';
      pinModalInput.value = '';
      pinModalCancel.removeEventListener('click', onCancel);
      pinModalConfirm.removeEventListener('click', onConfirm);
      pinModalInput.removeEventListener('keydown', onKeyDown);
      pinModalOverlay.removeEventListener('click', onOverlayClick);
      resolve(result);
    };

    const onCancel = () => cleanup(null);

    const onConfirm = () => {
      const pin = pinModalInput.value.trim();
      if (!pin) {
        pinModalError.textContent = 'Pairing PIN is required.';
        pinModalInput.focus();
        return;
      }
      cleanup(pin);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        onConfirm();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };

    const onOverlayClick = (event) => {
      if (event.target === pinModalOverlay) onCancel();
    };

    pinModalOverlay.style.display = 'flex';
    pinModalError.textContent = '';
    pinModalInput.value = '';
    pinModalCancel.addEventListener('click', onCancel);
    pinModalConfirm.addEventListener('click', onConfirm);
    pinModalInput.addEventListener('keydown', onKeyDown);
    pinModalOverlay.addEventListener('click', onOverlayClick);
    window.setTimeout(() => pinModalInput.focus(), 0);
  });
}

function renderPeeringPeers(allpeers, masters) {
  if (!peeringPeerList || !peeringNoPeers) return;
  const peers = allpeers.filter(peer => {
    return !masters.find(master =>
      (master.instanceId && peer.txt?.instanceId && master.instanceId === peer.txt.instanceId) ||
      (master.host === peer.host && (master.pairingPort === peer.port || master.pairingPort === peer.txt?.pairingPort))
    );
  });
  peeringPeerList.innerHTML = '';
  peeringNoPeers.style.display = peers.length ? 'none' : 'block';

  peers.forEach((peer) => {
    const li = document.createElement('li');
    li.className = 'peer-item';

    const meta = document.createElement('div');
    meta.className = 'peer-meta';
    const icon = document.createElement('div');
    icon.className = 'peer-icon';
    icon.textContent = '📡';
    const details = document.createElement('div');
    details.className = 'peer-meta-details';
    const name = document.createElement('strong');
    name.textContent = peer.name || 'Unnamed';
    const host = document.createElement('small');
    host.textContent = `${peer.host || 'unknown'}:${peer.port || peer.txt?.pairingPort || ''}`;
    details.appendChild(name);
    details.appendChild(host);
    meta.appendChild(icon);
    meta.appendChild(details);

    const button = document.createElement('button');
    button.textContent = t('Pair');
    button.addEventListener('click', async () => {
      const pin = await requestPeeringPin();
      if (!pin) { setPeeringStatus('Pairing PIN is required.', true); return; }
      button.disabled = true;
      setPeeringStatus('Pairing...');
      try {
        await window.electronAPI.pairWithPeer({ ...peer, pairingPin: pin });
        setPeeringStatus('Paired successfully.');
        const masters = await refreshPeeringPaired();
        const peers = await window.electronAPI.getMdnsPeers();
        renderPeeringPeers(peers, masters);
      } catch (err) {
        setPeeringStatus(err.message || 'Pairing failed.', true);
      } finally {
        button.disabled = false;
      }
    });

    li.appendChild(meta);
    li.appendChild(button);
    peeringPeerList.appendChild(li);
  });
}

function renderPeeringPaired(masters) {
  if (!peeringPairedList || !peeringNoPaired) return;
  peeringPairedList.innerHTML = '';
  peeringNoPaired.style.display = masters.length ? 'none' : 'block';

  masters.forEach((master) => {
    const li = document.createElement('li');
    li.className = 'peer-item';

    const meta = document.createElement('div');
    meta.className = 'peer-meta';
    const icon = document.createElement('div');
    icon.className = 'peer-icon';
    icon.textContent = master.host ? '🌐' : (master.hostHint ? '📌' : '⛔');
    const details = document.createElement('div');
    details.className = 'peer-meta-details';
    const name = document.createElement('strong');
    name.textContent = master.name || master.instanceId || 'Unknown';
    const host = document.createElement('small');
    host.textContent = `${master.host || master.hostHint || 'unknown'}:${master.pairingPort || master.pairingPortHint || ''}`;
    details.appendChild(name);
    details.appendChild(host);
    meta.appendChild(icon);
    meta.appendChild(details);

    const button = document.createElement('button');
    button.className = 'unpair-button';
    button.textContent = t('Unpair');
    button.addEventListener('click', async () => {
      button.disabled = true;
      setPeeringStatus('Unpairing...');
      try {
        await window.electronAPI.unpairPeer(master);
        setPeeringStatus('Unpaired successfully.');
        const masters = await refreshPeeringPaired();
        const peers = await window.electronAPI.getMdnsPeers();
        renderPeeringPeers(peers, masters);
      } catch (err) {
        setPeeringStatus(err.message || 'Unpairing failed.', true);
      } finally {
        button.disabled = false;
      }
    });

    li.appendChild(meta);
    li.appendChild(button);
    peeringPairedList.appendChild(li);
  });
}

async function refreshPeeringPaired() {
  const masters = await window.electronAPI.getPairedMasters();
  renderPeeringPaired(masters);
  return masters;
}

async function peeringPairByIp() {
  const host = peeringPairIpInput?.value.trim();
  const portValue = peeringPairPortInput?.value.trim();
  const port = portValue ? Number.parseInt(portValue, 10) : NaN;
  const natCompatibility = peeringPairNatInput?.checked === true;

  if (!host) { setPeeringStatus('IP address is required.', true); return; }
  if (!Number.isFinite(port) || port <= 0) { setPeeringStatus('Pairing port is required.', true); return; }

  const pin = await requestPeeringPin();
  if (!pin) { setPeeringStatus('Pairing PIN is required.', true); return; }

  if (peeringPairIpBtn) peeringPairIpBtn.disabled = true;
  setPeeringStatus('Pairing...');
  try {
    await window.electronAPI.pairWithPeerByIp({ host, port, pairingPin: pin, natCompatibility });
    setPeeringStatus('Paired successfully.');
    const masters = await refreshPeeringPaired();
    const peers = await window.electronAPI.getMdnsPeers();
    renderPeeringPeers(peers, masters);
  } catch (err) {
    setPeeringStatus(err.message || 'Pairing failed.', true);
  } finally {
    if (peeringPairIpBtn) peeringPairIpBtn.disabled = false;
  }
}

async function initPeering() {
  const enabled = await refreshPeeringFollowerMode();
  if (!enabled) return;
  if (!peeringInitialized) {
    const masters = await refreshPeeringPaired();
    const peers = await window.electronAPI.getMdnsPeers();
    renderPeeringPeers(peers, masters);
    peeringInitialized = true;
  }
}

if (window.electronAPI?.onMdnsPeersUpdated) {
  window.electronAPI.onMdnsPeersUpdated(async (peers) => {
    if (!peeringFollowerEnabled) return;
    const masters = await refreshPeeringPaired();
    renderPeeringPeers(peers, masters);
  });
}

// ─── End Peer Pairing Tab ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  if (!window.translationsLoaded) {
    await new Promise((resolve) => {
      window.addEventListener('translations-loaded', resolve, { once: true });
    });
  }
  applySettingsLocalizations();
  await loadSettings();

  // Mark dirty on any form field change within the tab panels
  document.querySelector('.tab-panels')?.addEventListener('change', markDirty);
  document.querySelector('.tab-panels')?.addEventListener('input', markDirty);

  // Info panel
  const settingsInfoBtn = document.getElementById('settingsInfoBtn');
  const settingsInfoDropdown = document.getElementById('settingsInfoDropdown');
  if (settingsInfoBtn && settingsInfoDropdown) {
    const infoPanel = createInfoPanel(settingsInfoDropdown, () => config);
    infoPanel.startPolling();
    settingsInfoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = settingsInfoDropdown.style.display === 'block';
      settingsInfoDropdown.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) infoPanel.triggerPoll();
    });
    document.addEventListener('click', (e) => {
      if (!settingsInfoDropdown.contains(e.target) && e.target !== settingsInfoBtn) {
        settingsInfoDropdown.style.display = 'none';
      }
    });
  }

  // Peer pairing setup
  initPeering();
  window.setInterval(() => {
    refreshPeeringFollowerMode().catch((err) => {
      console.error('Failed to refresh peering follower mode:', err);
    });
  }, 1500);
  window.addEventListener('focus', () => {
    refreshPeeringFollowerMode().catch((err) => {
      console.error('Failed to refresh peering follower mode on focus:', err);
    });
  });

  if (peeringPairIpBtn) {
    peeringPairIpBtn.addEventListener('click', () => {
      if (!peeringFollowerEnabled) return;
      peeringPairByIp();
    });
  }
  if (peeringManualToggle && peeringManualSection) {
    peeringManualToggle.addEventListener('click', () => {
      if (!peeringFollowerEnabled) return;
      const isVisible = peeringManualSection.style.display !== 'none';
      peeringManualSection.style.display = isVisible ? 'none' : 'block';
    });
  }

  // Switch to peer tab if opened via the Peer Pairing menu item
  const initialTab = new URLSearchParams(location.search).get('tab');
  if (initialTab) {
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${CSS.escape(initialTab)}"]`);
    if (tabBtn) tabBtn.click();
  }
});

window.translationsources.push('/admin/locales/translations.json');
