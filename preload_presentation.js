const { contextBridge, ipcRenderer } = require('electron');
const DISABLE_CONTEXT_MENU_ARG = '--revelation-disable-context-menu=1';
const disableContextMenu = Array.isArray(process.argv)
  && process.argv.includes(DISABLE_CONTEXT_MENU_ARG);

function openExternalIfNeeded(event) {
  const anchor = event.target?.closest?.('a[href]');
  if (!anchor) return;

  const href = anchor.getAttribute('href');
  if (!href) return;

  if (href.startsWith('#')) return;

  try {
    const url = new URL(href, window.location.href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.host === window.location.host) return;

    event.preventDefault();
    ipcRenderer.send('open-external-url', url.toString());
  } catch {
    // Ignore invalid URLs in markdown content.
  }
}

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', openExternalIfNeeded, true);
  if (disableContextMenu) {
    // Block renderer-level contextmenu listeners (including the custom Reveal menu).
    document.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }
});

contextBridge.exposeInMainWorld('electronAPI', {
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),
  getPluginList: (options = false) => ipcRenderer.invoke('get-plugin-list', options),
  presentationPluginTrigger: (plugin, invoke, data) => ipcRenderer.invoke('presentation-plugin-trigger', plugin, invoke, data),
  sendPeerCommand: (command) => ipcRenderer.invoke('send-peer-command', command),
  toggleFullScreen: () => ipcRenderer.invoke('toggle-presentation'),
  closePresentation: () => ipcRenderer.invoke('close-presentation'),
  onPresentationPluginEvent: (pluginName, callback) => {
    const handler = (_event, message) => {
      if (!message || message.plugin !== pluginName) return;
      callback(message);
    };
    ipcRenderer.on('presentation-plugin-event', handler);
    return () => ipcRenderer.removeListener('presentation-plugin-event', handler);
  }
});
