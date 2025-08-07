// preload.js
const { contextBridge, ipcRenderer, shell } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[href]');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href.startsWith('http')) return;

    try {
      const url = new URL(href);
      const currentHost = window.location.host; // e.g., "localhost:8000"

      if (url.host !== currentHost) {
        // External link — open in system browser
        event.preventDefault();
        ipcRenderer.send('open-external-url', href); 
      }
      // else: allow normal navigation within the app
    } catch (err) {
      console.warn('Invalid URL:', href);
    }
  });
});

contextBridge.exposeInMainWorld('electronAPI', {
  createPresentation: (data) => ipcRenderer.invoke('create-presentation', data),
  editPresentationMetadata: (slug, mdFile) => ipcRenderer.invoke('edit-presentation-metadata', slug, mdFile),
  savePresentationMetadata: (slug, mdFile, data) => ipcRenderer.invoke('save-presentation-metadata', slug, mdFile, data),
  hashAndStoreMedia: async (filePath, metadata) => ipcRenderer.invoke('hash-and-store-media', filePath, metadata),
  getAvailableThemes: () => ipcRenderer.invoke('getAvailableThemes'),
  openPresentation: (slug, mdFile, fullscreen) => ipcRenderer.invoke('open-presentation', slug, mdFile, fullscreen),
  exportPresentationPDF: (slug, mdFile) => ipcRenderer.invoke('export-presentation-pdf', slug, mdFile),
  openHandoutView: (slug, mdFile) => ipcRenderer.invoke('open-handout', slug, mdFile),
  toggleFullScreen: () => ipcRenderer.invoke('toggle-presentation'),
  showPresentationFolder: (slug) => ipcRenderer.invoke('show-presentation-folder', slug),
  editPresentation: (slug, mdFile) => ipcRenderer.invoke('edit-presentation', slug, mdFile),
  exportPresentation: (slug) => ipcRenderer.invoke('export-presentation', slug),
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),
  saveAppConfig: (updates) => ipcRenderer.invoke('save-app-config', updates),
  reloadServers: () => ipcRenderer.invoke('reload-servers'),
  getDisplayList: () => ipcRenderer.invoke('get-display-list'),
  onShowToast: (callback) => ipcRenderer.on('show-toast', (_event, msg) => callback(msg)),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getPluginList: () => ipcRenderer.invoke('get-plugin-list'),
  pluginTrigger: (plugin, invoke, data) => ipcRenderer.invoke('plugin-trigger', plugin, invoke, data)
});

