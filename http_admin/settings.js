// /admin/settings.js

const displaySelect = document.getElementById('preferredDisplay');
const vitePortInput = document.getElementById('viteServerPort');
const remotePortInput = document.getElementById('revealRemoteServerPort');
const saveButton = document.getElementById('saveBtn');
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
}

async function saveSettings() {
  const updated = {
    preferredDisplay: parseInt(displaySelect.value),
    viteServerPort: parseInt(vitePortInput.value),
    revealRemoteServerPort: parseInt(remotePortInput.value),
  };

  await window.electronAPI.saveAppConfig(updated);
  if (config.viteServerPort !== updated.viteServerPort ||
     config.revealRemoteServerPort !== updated.revealRemoteServerPort) {
    await window.electronAPI.reloadServers();
  } 
  window.close();
}

saveButton.addEventListener('click', saveSettings);

loadSettings();
