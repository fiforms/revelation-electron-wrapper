const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('firstRunAPI', {
  getState: () => ipcRenderer.invoke('first-run:get-state'),
  complete: (language) => ipcRenderer.invoke('first-run:complete', { language }),
  cancel: () => ipcRenderer.invoke('first-run:cancel')
});
