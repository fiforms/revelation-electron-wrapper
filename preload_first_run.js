// preload_first_run.js -- preload for the first-run language/setup window.
// Exposes `window.firstRunAPI` (used by http_admin/first-run-language.html); channels are handled in lib/firstRunWizard.js
// (first-run:get-state, :complete, :open-link, :install-plugin, :get-bible-groups, :install-bibles, :cancel). Created by lib/firstRunWizard.js createFirstRunWindow().

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('firstRunAPI', {
  getState: () => ipcRenderer.invoke('first-run:get-state'),
  complete: (language, options = {}) => ipcRenderer.invoke('first-run:complete', {
    language,
    openPluginSettings: options.openPluginSettings === true
  }),
  openLink: (link) => ipcRenderer.invoke('first-run:open-link', { link }),
  installPlugin: (id) => ipcRenderer.invoke('first-run:install-plugin', id),
  getBibleGroups: (language) => ipcRenderer.invoke('first-run:get-bible-groups', { language }),
  installBibles: (id, options = {}) => ipcRenderer.invoke('first-run:install-bibles', { id, groups: options.groups }),
  onInstallProgress: (callback) => {
    ipcRenderer.on('first-run:install-progress', (_event, progress) => callback(progress));
  },
  cancel: () => ipcRenderer.invoke('first-run:cancel')
});
