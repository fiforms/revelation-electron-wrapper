// preload.js
window.addEventListener('DOMContentLoaded', () => {
  // preload logic (if needed)
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  createPresentation: (data) => ipcRenderer.invoke('create-presentation', data),
  openPresentation: (slug, mdFile) => ipcRenderer.invoke('open-presentation', slug, mdFile),
  showPresentationFolder: (slug) => ipcRenderer.invoke('show-presentation-folder', slug),
  editPresentation: (slug, mdFile) => ipcRenderer.invoke('edit-presentation', slug, mdFile)
});

