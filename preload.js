// preload.js
const { contextBridge, ipcRenderer, shell, webFrame } = require('electron');

const DEFAULT_MARKDOWN_IGNORE_WORDS = [
  'bgtint',
  'rgba',
  'revelation',
  'attrib',
  'autoslide',
  'animate',
  'audio',
  'darkbg',
  'lightbg',
  'darktext',
  'lighttext',
  'shiftright',
  'shiftleft',
  'lowerthird',
  'upperthird',
  'info',
  'background',
  'sticky',
  'fit'
];

function normalizeSpellWord(word) {
  return String(word || '')
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9_]+|[^a-z0-9_]+$/g, '');
}

function createIgnoredWordSet(words) {
  const set = new Set();
  for (const word of words || []) {
    const normalized = normalizeSpellWord(word);
    if (normalized) set.add(normalized);
  }
  return set;
}

function shouldIgnoreMarkdownWord(word, ignoredWords) {
  const normalized = normalizeSpellWord(word);
  if (!normalized) return true;
  if (ignoredWords.has(normalized)) return true;
  const colonIndex = normalized.indexOf(':');
  if (colonIndex > 0) {
    const prefix = normalized.slice(0, colonIndex);
    if (ignoredWords.has(prefix)) return true;
  }
  if (/^(?:https?:\/\/|media:)/i.test(String(word || ''))) return true;
  if (/^[0-9]+(?:[.:][0-9]+)*$/.test(normalized)) return true;
  return false;
}

function configureBuilderSpellcheck(options = {}) {
  if (!webFrame?.setSpellCheckProvider || !webFrame?.isWordMisspelled) {
    return false;
  }

  const markdownEditorIds = Array.isArray(options.markdownEditorIds)
    ? options.markdownEditorIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const fallbackMarkdownEditorId = String(options.markdownEditorId || 'slide-editor').trim();
  if (!markdownEditorIds.length && fallbackMarkdownEditorId) {
    markdownEditorIds.push(fallbackMarkdownEditorId);
  }
  const markdownEditorIdSet = new Set(markdownEditorIds);
  const requestedLanguage = String(options.language || '').trim();
  const language =
    requestedLanguage || document?.documentElement?.lang || navigator.language || 'en-US';
  const ignoredWords = createIgnoredWordSet([
    ...DEFAULT_MARKDOWN_IGNORE_WORDS,
    ...(Array.isArray(options.markdownIgnoreWords) ? options.markdownIgnoreWords : [])
  ]);

  webFrame.setSpellCheckProvider(language, {
    spellCheck(words, callback) {
      const activeEditorId = document?.activeElement?.id || '';
      const isMarkdownEditor = markdownEditorIdSet.has(activeEditorId);
      const misspeltWords = [];
      for (const word of words || []) {
        if (isMarkdownEditor && shouldIgnoreMarkdownWord(word, ignoredWords)) continue;
        if (webFrame.isWordMisspelled(word)) {
          misspeltWords.push(word);
        }
      }
      callback(misspeltWords);
    }
  });

  return true;
}

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
  exportPresentation: (slug, includeMedia, showSplashscreen) => ipcRenderer.invoke('export-presentation', slug, includeMedia, showSplashscreen),
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
  getPresentationVariants: (payload) => ipcRenderer.invoke('get-presentation-variants', payload),
  addPresentationVariant: (payload) => ipcRenderer.invoke('add-presentation-variant', payload),
  savePresentationMarkdown: (payload) => ipcRenderer.invoke('save-presentation-markdown', payload),
  cleanupPresentationTemp: (payload) => ipcRenderer.invoke('cleanup-presentation-temp', payload),
  configureBuilderSpellcheck: (options) => configureBuilderSpellcheck(options),
  getWordSuggestions: (word) => {
    if (!webFrame?.getWordSuggestions) return [];
    return webFrame.getWordSuggestions(String(word || ''));
  },
  importMissingMedia: (slug) => ipcRenderer.invoke('import-missing-media', slug),
  onExportStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('export-status', handler);
    return () => ipcRenderer.removeListener('export-status', handler);
  }
});
