// /admin/settings.js

const languageSelect = document.getElementById('language');
const preferredPresentationLanguage = document.getElementById('preferredPresentationLanguage');
const ccliLicenseNumber = document.getElementById('ccliLicenseNumber');
const screenTypeVariant = document.getElementById('screenTypeVariant');
const displaySelect = document.getElementById('preferredDisplay');
const vitePortInput = document.getElementById('viteServerPort');
const startupMode = document.getElementById('startupMode');
const remotePortInput = document.getElementById('revealRemoteServerPort');
const revealRemoteInput = document.getElementById('revealRemotePublicServer');
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
    { value: '', label: 'Normal' },
    { value: 'lowerthirds', label: 'Lower Thirds' },
    { value: 'confidencemonitor', label: 'Confidence Monitor' },
    { value: 'notes', label: 'Notes' }
  ];
}

function renderAdditionalScreens(additionalScreens = []) {
  additionalScreensList.innerHTML = '';
  const rows = Array.isArray(additionalScreens) ? additionalScreens : [];
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'additional-screens-empty';
    empty.textContent = 'No additional screens configured.';
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
  targetLabel.textContent = 'Screen';
  const targetSelect = document.createElement('select');
  targetSelect.className = 'additional-screen-target';
  const windowOption = document.createElement('option');
  windowOption.value = 'window';
  windowOption.textContent = 'Window only';
  targetSelect.appendChild(windowOption);
  const publishOption = document.createElement('option');
  publishOption.value = 'publish';
  publishOption.textContent = 'URL Publish';
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
  langLabel.textContent = 'Language';
  const langInput = document.createElement('input');
  langInput.className = 'additional-screen-language';
  langInput.maxLength = 8;
  langInput.placeholder = 'default';
  langInput.value = normalized.language || '';
  langWrapper.appendChild(langLabel);
  langWrapper.appendChild(langInput);

  const variantWrapper = document.createElement('div');
  const variantLabel = document.createElement('label');
  variantLabel.textContent = 'Variant';
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
  defaultModeLabel.textContent = 'Default Screen';
  const defaultModeSelect = document.createElement('select');
  defaultModeSelect.className = 'additional-screen-default-mode';
  [
    { value: '', label: 'Use Main Default' },
    { value: 'black', label: 'Solid Black' },
    { value: 'green', label: 'Solid Green' },
    { value: 'presentation', label: 'Default Presentation' }
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
  defaultPresentationLabel.textContent = 'Default Pres Path';
  const defaultPresentationInput = document.createElement('input');
  defaultPresentationInput.className = 'additional-screen-default-presentation';
  defaultPresentationInput.placeholder = 'slug/presentation.md';
  defaultPresentationInput.value = normalized.defaultPresentation || '';
  defaultPresentationWrapper.appendChild(defaultPresentationLabel);
  defaultPresentationWrapper.appendChild(defaultPresentationInput);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'additional-screen-remove';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => {
    row.remove();
    if (!additionalScreensList.children.length) {
      renderAdditionalScreens([]);
    }
    refreshPublishUrlField();
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
    recordBtn.textContent = isActive ? 'Press keys...' : 'Record';
  });
  btn?.focus();
}

function stopRecordingHotkey() {
  recordingAction = null;
  hotkeyRows.forEach((row) => {
    const recordBtn = row.querySelector('.hotkey-record');
    if (!recordBtn) return;
    recordBtn.classList.remove('recording');
    recordBtn.textContent = 'Record';
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
  remotePortInput.value = config.revealRemoteServerPort;
  revealRemoteInput.value = config.revealRemotePublicServer;
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
  ccliLicenseNumber.value = config.ccliLicenseNumber || '';
  screenTypeVariant.value = config.screenTypeVariant || '';
  updateCheckEnabled.checked = config.updateCheckEnabled !== false;
  pipEnabled.checked = config.pipEnabled || false;
  pipSide.value = config.pipSide || 'left';
  pipColor.value = config.pipColor || '#00ff00';
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
    }
  });

  await renderPluginList(config.allPluginFolders || []);

}

async function renderPluginList(allPlugins) {
  const enabledPlugins = await window.electronAPI.getPluginList(true);
  pluginListContainer.innerHTML = '';

  const pluginConfigDraft = {}; // For live updates before saving

  allPlugins.forEach(pluginName => {
    const id = `plugin-${pluginName}`;
    const plugin = enabledPlugins[pluginName];

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.name = pluginName;
    checkbox.checked = !!plugin;

    const label = document.createElement('label');
    label.htmlFor = id;
    label.style.marginLeft = '0.5em';

    // 🆕 Build name + version text
    const nameSpan = document.createElement('span');
    nameSpan.textContent = pluginName;

    const versionSpan = document.createElement('span');
    versionSpan.textContent = plugin?.version ? ` v${plugin.version}` : '';
    versionSpan.style.color = '#999';
    versionSpan.style.fontSize = '0.9em';
    versionSpan.style.marginLeft = '0.3em';
    versionSpan.classList.add('version');

    // Combine
    label.appendChild(nameSpan);
    label.appendChild(versionSpan);

    const wrapper = document.createElement('div');
    wrapper.className = 'plugin-item';
    const headerRow = document.createElement('div');
    headerRow.className = 'plugin-header-row';
    headerRow.appendChild(checkbox);
    headerRow.appendChild(label);

    const docButton = document.createElement('button');
    docButton.type = 'button';
    docButton.className = 'plugin-doc-button';
    docButton.textContent = '❔';
    docButton.title = `Open docs for ${pluginName}`;
    docButton.addEventListener('click', () => {
      const pluginDocFile = docsKeyToPresentationFile(`plugins/${pluginName}/README.md`);
      openDocsHandout(pluginDocFile);
    });
    headerRow.appendChild(docButton);
    wrapper.appendChild(headerRow);

    // ⬇️ Container for plugin settings (only if enabled)
    const settingsContainer = document.createElement('fieldset');

    const hasFields =
      plugin?.configTemplate &&
      Array.isArray(plugin.configTemplate) &&
      plugin.configTemplate.length > 0;
    if (hasFields) {
      settingsContainer.className = 'plugin-settings-fields';
      settingsContainer.style.display = checkbox.checked ? 'block' : 'none';
    }
    else {
      settingsContainer.style.display = 'none';
    }
    if (plugin?.configTemplate) {
      pluginConfigDraft[pluginName] = { ...plugin.config }; // clone current config

      plugin.configTemplate.forEach(field => {
        const fieldWrapper = document.createElement('div');
        fieldWrapper.style.marginBottom = '0.8em';

        const label = document.createElement('label');
        label.textContent = field.description || field.name;
        label.htmlFor = `${pluginName}-${field.name}`;
        label.style.display = 'block';
        label.style.marginBottom = '0.2em';

        let input;
        if (field.ui === 'dropdown' && Array.isArray(field.dropdownOptions)) {
          input = document.createElement('select');
          field.dropdownOptions.forEach(opt => {
            const optEl = document.createElement('option');
            optEl.value = opt;
            optEl.textContent = opt;
            input.appendChild(optEl);
          });
          input.value = plugin.config[field.name] || field.default;
        } else {
          input = document.createElement('input');
          input.type = 'text';
          input.value = plugin.config[field.name] || field.default || '';
        }

        input.id = `${pluginName}-${field.name}`;
        input.name = field.name;
        input.style.width = '100%';

        input.addEventListener('change', () => {
          pluginConfigDraft[pluginName][field.name] = input.value;
        });

        fieldWrapper.appendChild(label);
        fieldWrapper.appendChild(input);
        settingsContainer.appendChild(fieldWrapper);
      });
    }

    wrapper.appendChild(settingsContainer);

    checkbox.addEventListener('change', () => {
      settingsContainer.style.display = checkbox.checked ? 'block' : 'none';
    });

    pluginListContainer.appendChild(wrapper);
  });

  // Expose live draft object if needed
  window.pluginConfigDraft = pluginConfigDraft;
}

async function saveSettings() {
  const instanceNameValue = mdnsInstanceName.value.trim();
  const pinValue = mdnsPairingPin.value.trim();
  const updated = {
    preferredDisplay: parseInt(displaySelect.value),
    language: languageSelect.value,
    preferredPresentationLanguage: preferredPresentationLanguage.value.trim().toLowerCase(),
    ccliLicenseNumber: ccliLicenseNumber.value.trim(),
    screenTypeVariant: screenTypeVariant.value.trim().toLowerCase(),
    updateCheckEnabled: updateCheckEnabled.checked,
    viteServerPort: parseInt(vitePortInput.value),
    revealRemoteServerPort: parseInt(remotePortInput.value),
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
              .filter(el => el.checked)
              .map(el => el.name),
    revealRemotePublicServer: revealRemoteInput.value,
    pluginConfigs: window.pluginConfigDraft || {}
  };

  const dup = hasDuplicateHotkeys(updated.globalHotkeys);
  if (dup) {
    window.alert(`Duplicate hotkey "${dup.duplicate}" is assigned to both "${dup.actionA}" and "${dup.actionB}".`);
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
settingsHelpBtn?.addEventListener('click', () => {
  const settingsDocFile = docsKeyToPresentationFile('doc/SETTINGS.md');
  openDocsHandout(settingsDocFile);
});
addAdditionalScreenBtn.addEventListener('click', () => addAdditionalScreenRow({}));
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
    copyPublishUrlBtn.textContent = 'Copied';
    setTimeout(() => {
      copyPublishUrlBtn.textContent = 'Copy URL';
    }, 1200);
  } catch {
    window.alert(url);
  }
});
virtualPeersDefaultMode.addEventListener('change', updateVirtualPeerDefaultFields);
bindHotkeyRecording();

document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
});

window.translationsources.push('/admin/locales/translations.json');
