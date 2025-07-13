// preload.js
window.addEventListener('DOMContentLoaded', () => {
  // preload logic (if needed)
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snapshotAPI', {
  createPresentation: (data) => ipcRenderer.invoke('create-presentation', data)
});

