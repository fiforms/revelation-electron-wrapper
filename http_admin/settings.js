// /admin/settings.js

const languageSelect = document.getElementById('language');
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

let config = {};

async function loadSettings() {
  config = await window.electronAPI.getAppConfig();
  const screens = await window.electronAPI.getDisplayList();

  screens.forEach((screen, index) => {
    const opt = document.createElement('option');
    opt.value = index;
    opt.textContent = `Display ${index + 1}: ${screen.bounds.width}x${screen.bounds.height}`;
    if (index === config.preferredDisplay) opt.selected = true;
    displaySelect.appendChild(opt);
  });

  vitePortInput.value = config.viteServerPort;
  remotePortInput.value = config.revealRemoteServerPort;
  revealRemoteInput.value = config.revealRemotePublicServer;
  ffmpegPath.value = config.ffmpegPath;
  ffprobePath.value = config.ffprobePath;
  startupMode.value = config.mode;
  presentationsDirInput.value = config.presentationsDir || '';
  preferHighBitrate.checked = config.preferHighBitrate || false;
  languageSelect.value = config.language || 'en';

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
  const updated = {
    preferredDisplay: parseInt(displaySelect.value),
    language: languageSelect.value,
    viteServerPort: parseInt(vitePortInput.value),
    revealRemoteServerPort: parseInt(remotePortInput.value),
    presentationsDir: presentationsDirInput.value.trim(),
    preferHighBitrate: preferHighBitrate.checked,
    ffmpegPath: ffmpegPath.value,
    ffprobePath: ffprobePath.value,
    mode: startupMode.value,
    plugins: Array.from(document.querySelectorAll('#plugin-list input[type="checkbox"]'))
              .filter(el => el.checked)
              .map(el => el.name),
    revealRemotePublicServer: revealRemoteInput.value,
    pluginConfigs: window.pluginConfigDraft || {}
  };

  await window.electronAPI.saveAppConfig(updated);

  await window.electronAPI.reloadServers();
  window.close();
}

saveButton.addEventListener('click', saveSettings);

document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
});

window.translationsources.push('/admin/locales/translations.json');