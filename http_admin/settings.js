// /admin/settings.js

const displaySelect = document.getElementById('preferredDisplay');
const vitePortInput = document.getElementById('viteServerPort');
const startupMode = document.getElementById('startupMode');
const remotePortInput = document.getElementById('revealRemoteServerPort');
const ffmpegPath = document.getElementById('ffmpegPath');
const saveButton = document.getElementById('saveBtn');
const pluginListContainer = document.getElementById('plugin-list');

let config = {};

function arraysEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, i) => val === sortedB[i]);
}

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
  ffmpegPath.value = config.ffmpegPath;
  startupMode.value = config.mode;

  await renderPluginList(config.allPluginFolders || []);

}

async function renderPluginList(allPlugins) {
  const enabledPlugins = await window.electronAPI.getPluginList(true);
  pluginListContainer.innerHTML = '';

  allPlugins.forEach(pluginName => {
    const id = `plugin-${pluginName}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.name = pluginName;
    checkbox.checked = enabledPlugins[pluginName] ? true : false;

    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = pluginName;
    label.style.marginLeft = '0.5em';

    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = '0.5em';
    wrapper.appendChild(checkbox);
    wrapper.appendChild(label);

    pluginListContainer.appendChild(wrapper);
  });
}

async function saveSettings() {
  const updated = {
    preferredDisplay: parseInt(displaySelect.value),
    viteServerPort: parseInt(vitePortInput.value),
    revealRemoteServerPort: parseInt(remotePortInput.value),
    ffmpegPath: ffmpegPath.value,
    mode: startupMode.value,
    plugins: Array.from(document.querySelectorAll('#plugin-list input[type="checkbox"]'))
              .filter(el => el.checked)
              .map(el => el.name)
  };

  await window.electronAPI.saveAppConfig(updated);
  const shouldReload =
    config.viteServerPort !== updated.viteServerPort ||
    config.revealRemoteServerPort !== updated.revealRemoteServerPort ||
    config.mode !== updated.mode ||
    !arraysEqual(config.plugins, updated.plugins);

  if (shouldReload) {
    await window.electronAPI.reloadServers();
  }
  window.close();
}

saveButton.addEventListener('click', saveSettings);

document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
});