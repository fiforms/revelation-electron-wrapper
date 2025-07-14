// preload.js
window.addEventListener('DOMContentLoaded', () => {
  // preload logic (if needed)
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  createPresentation: (data) => ipcRenderer.invoke('create-presentation', data),
  openPresentation: (slug, mdFile, fullscreen) => ipcRenderer.invoke('open-presentation', slug, mdFile, fullscreen),
  toggleFullScreen: () => ipcRenderer.invoke('toggle-presentation'),
  showPresentationFolder: (slug) => ipcRenderer.invoke('show-presentation-folder', slug),
  editPresentation: (slug, mdFile) => ipcRenderer.invoke('edit-presentation', slug, mdFile),
  exportPresentation: (slug) => ipcRenderer.invoke('export-presentation', slug)
});

