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

let config = {};
let displayOptions = [];

function normalizeAdditionalScreen(entry = {}) {
  const target = entry.target === 'display' ? 'display' : 'window';
  const parsedIndex = Number.parseInt(entry.displayIndex, 10);
  const displayIndex = Number.isFinite(parsedIndex) && parsedIndex >= 0 ? parsedIndex : null;
  const language = typeof entry.language === 'string' ? entry.language.trim().toLowerCase() : '';
  const variant = typeof entry.variant === 'string' ? entry.variant.trim().toLowerCase() : '';
  if (target === 'display' && displayIndex === null) {
    return null;
  }
  return { target, displayIndex, language, variant };
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
    variant: ''
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
  displayOptions.forEach((opt) => {
    const displayOption = document.createElement('option');
    displayOption.value = `display:${opt.index}`;
    displayOption.textContent = opt.label;
    targetSelect.appendChild(displayOption);
  });
  targetSelect.value = normalized.target === 'display' ? `display:${normalized.displayIndex}` : 'window';
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

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'additional-screen-remove';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => {
    row.remove();
    if (!additionalScreensList.children.length) {
      renderAdditionalScreens([]);
    }
  });

  row.appendChild(targetWrapper);
  row.appendChild(langWrapper);
  row.appendChild(variantWrapper);
  row.appendChild(removeBtn);

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
      if (targetValue === 'window') {
        return normalizeAdditionalScreen({
          target: 'window',
          displayIndex: null,
          language,
          variant
        });
      }
      if (!targetValue.startsWith('display:')) return null;
      const displayIndex = Number.parseInt(targetValue.split(':')[1], 10);
      return normalizeAdditionalScreen({
        target: 'display',
        displayIndex,
        language,
        variant
      });
    })
    .filter(Boolean);
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
  renderAdditionalScreens(config.additionalScreens || []);

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
    wrapper.style.marginBottom = '1em';
    wrapper.appendChild(checkbox);
    wrapper.appendChild(label);

    // ⬇️ Container for plugin settings (only if enabled)
    const settingsContainer = document.createElement('fieldset');

    const hasFields =
      plugin?.configTemplate &&
      Array.isArray(plugin.configTemplate) &&
      plugin.configTemplate.length > 0;
    if (hasFields) {
      settingsContainer.style.marginTop = '0.5em';
      settingsContainer.style.padding = '0.5em 1em';
      settingsContainer.style.border = '1px solid #444';
      settingsContainer.style.borderRadius = '6px';
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
    additionalScreens: readAdditionalScreensFromForm(),
    mdnsInstanceName: instanceNameValue ? instanceNameValue : config.mdnsInstanceName,
    mdnsPairingPin: pinValue || config.mdnsPairingPin || '',
    plugins: Array.from(document.querySelectorAll('#plugin-list input[type="checkbox"]'))
              .filter(el => el.checked)
              .map(el => el.name),
    revealRemotePublicServer: revealRemoteInput.value,
    pluginConfigs: window.pluginConfigDraft || {}
  };

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
addAdditionalScreenBtn.addEventListener('click', () => addAdditionalScreenRow({}));

document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
});

window.translationsources.push('/admin/locales/translations.json');
