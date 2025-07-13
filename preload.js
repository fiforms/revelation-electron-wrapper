// preload.js
window.addEventListener('DOMContentLoaded', () => {
  // preload logic (if needed)
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  createPresentation: (data) => ipcRenderer.invoke('create-presentation', data),
  openPresentation: (slug, mdFile) => ipcRenderer.invoke('open-presentation', slug, mdFile)
});

