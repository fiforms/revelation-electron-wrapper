// preload_first_run.js -- preload for the first-run language/setup window.
// Exposes `window.firstRunAPI` (used by http_admin/first-run-language.html); channels are handled in main.js
// (first-run:get-state, :complete, :open-link, :install-poppler, :cancel). Created by main.js createFirstRunLanguageWindow().

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('firstRunAPI', {
  getState: () => ipcRenderer.invoke('first-run:get-state'),
  complete: (language, options = {}) => ipcRenderer.invoke('first-run:complete', {
    language,
    openPluginSettings: options.openPluginSettings === true
  }),
  openLink: (link) => ipcRenderer.invoke('first-run:open-link', { link }),
  installPoppler: () => ipcRenderer.invoke('first-run:install-poppler'),
  onInstallProgress: (callback) => {
    ipcRenderer.on('first-run:install-progress', (_event, progress) => callback(progress));
  },
  cancel: () => ipcRenderer.invoke('first-run:cancel')
});
