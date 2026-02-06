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
  closePresentation: () => ipcRenderer.invoke('close-presentation'),
  exportPresentationPDF: (slug, mdFile) => ipcRenderer.invoke('export-presentation-pdf', slug, mdFile),
  openHandoutView: (slug, mdFile) => ipcRenderer.invoke('open-handout', slug, mdFile),
  toggleFullScreen: () => ipcRenderer.invoke('toggle-presentation'),
  showPresentationFolder: (slug) => ipcRenderer.invoke('show-presentation-folder', slug),
  editPresentation: (slug, mdFile) => ipcRenderer.invoke('edit-presentation', slug, mdFile),
  showExportWindow: (slug) => ipcRenderer.invoke('show-export-window', slug),
  exportImages: (slug, mdFile, width, height, delay, thumbnail) => ipcRenderer.invoke('export-presentation-images', slug, mdFile, width, height, delay, thumbnail),
  exportPresentation: (slug, includeMedia) => ipcRenderer.invoke('export-presentation', slug, includeMedia),
  deletePresentation: (slug, mdFile) => ipcRenderer.invoke('delete-presentation', slug, mdFile),
  selectPresentationsDir: () => ipcRenderer.invoke('select-presentations-dir'),
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),
  saveAppConfig: (updates) => ipcRenderer.invoke('save-app-config', updates),
  getUsedMedia: () => ipcRenderer.invoke('get-used-media'),
  listPresentationImages: (slug) => ipcRenderer.invoke('list-presentation-images', slug),
  deleteMediaItem: (filename) => ipcRenderer.invoke('delete-media-item', filename),
  downloadLargeVariant: (filename) => ipcRenderer.invoke('download-large-variant', filename),
  deleteLargeVariant: (filename) => ipcRenderer.invoke('delete-large-variant', filename),
  convertLargeVariant: (filename) => ipcRenderer.invoke('convert-large-variant', filename),
  reloadServers: () => ipcRenderer.invoke('reload-servers'),
  getDisplayList: () => ipcRenderer.invoke('get-display-list'),
  getRuntimeInfo: () => ipcRenderer.invoke('get-runtime-info'),
  getMdnsPeers: () => ipcRenderer.invoke('get-mdns-peers'),
  getPairedMasters: () => ipcRenderer.invoke('get-paired-masters'),
  pairWithPeer: (peer) => ipcRenderer.invoke('pair-with-peer', peer),
  pairWithPeerByIp: (data) => ipcRenderer.invoke('pair-with-peer-ip', data),
  unpairPeer: (master) => ipcRenderer.invoke('unpair-peer', master),
  sendPeerCommand: (command) => ipcRenderer.invoke('send-peer-command', command),
  onMdnsPeersUpdated: (callback) => ipcRenderer.on('mdns-peers-updated', (_event, peers) => callback(peers)),
  onShowToast: (callback) => ipcRenderer.on('show-toast', (_event, msg) => callback(msg)),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: (options = {}) => ipcRenderer.invoke('check-for-updates', options),
  getPluginList: (options = false) => ipcRenderer.invoke('get-plugin-list', options),
  openExternalURL: (url) => ipcRenderer.send('open-external-url', url),
  saveCurrentPresentation: (data) => ipcRenderer.invoke('save-current-presentation', data),
  getCurrentPresentation: () => ipcRenderer.invoke('get-current-presentation'),
  clearCurrentPresentation: () => ipcRenderer.invoke('clear-current-presentation'),
  pluginTrigger: (plugin, invoke, data) => ipcRenderer.invoke('plugin-trigger', plugin, invoke, data),
  openPresentationBuilder: (slug, mdFile) => ipcRenderer.invoke('open-presentation-builder', slug, mdFile),
  savePresentationMarkdown: (payload) => ipcRenderer.invoke('save-presentation-markdown', payload),
  cleanupPresentationTemp: (payload) => ipcRenderer.invoke('cleanup-presentation-temp', payload),
  importMissingMedia: (slug) => ipcRenderer.invoke('import-missing-media', slug),
  onExportStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('export-status', handler);
    return () => ipcRenderer.removeListener('export-status', handler);
  }
});
