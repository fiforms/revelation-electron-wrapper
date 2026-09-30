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
