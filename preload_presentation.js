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

// Fade the #screen-cover to fully black (opacity 1).
// Returns a Promise that resolves once the transition completes.
function performFadeToBlack(durationMs = 500) {
  return new Promise((resolve) => {
    const cover = document.getElementById('screen-cover');
    if (!cover) { resolve(); return; }
    // Already black — nothing to do.
    if (!cover.classList.contains('faded-out')) { resolve(); return; }

    cover.style.transition = `opacity ${durationMs}ms ease`;
    cover.classList.remove('faded-out');

    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    const onTransitionEnd = (e) => {
      if (e.propertyName !== 'opacity') return;
      cover.removeEventListener('transitionend', onTransitionEnd);
      done();
    };
    cover.addEventListener('transitionend', onTransitionEnd);
    // Fallback in case transitionend doesn't fire (e.g. no GPU compositing).
    setTimeout(done, durationMs + 150);
  });
}

// Allow the main process to request a fade-to-black (e.g. before closing the window).
// After the fade completes the renderer sends 'presentation-fade-to-black-done' back.
ipcRenderer.on('presentation-fade-to-black-request', async () => {
  await performFadeToBlack();
  ipcRenderer.send('presentation-fade-to-black-done');
});

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
  presentationPluginTrigger: (plugin, invoke, data) => ipcRenderer.invoke('presentation-plugin-trigger', plugin, invoke, data),
  sendPeerCommand: (command) => ipcRenderer.invoke('send-peer-command', command),
  toggleFullScreen: () => ipcRenderer.invoke('toggle-presentation'),
  closePresentation: () => ipcRenderer.invoke('close-presentation'),
  // Fade the presentation to black. Returns a Promise that resolves when the
  // screen is fully black. Also sends 'presentation-fade-to-black-done' to the
  // main process so it knows it is safe to close the window.
  fadeToBlack: (durationMs = 500) => {
    return performFadeToBlack(durationMs).then(() => {
      ipcRenderer.send('presentation-fade-to-black-done');
    });
  },
  onPresentationPluginEvent: (pluginName, callback) => {
    const handler = (_event, message) => {
      if (!message || message.plugin !== pluginName) return;
      callback(message);
    };
    ipcRenderer.on('presentation-plugin-event', handler);
    return () => ipcRenderer.removeListener('presentation-plugin-event', handler);
  }
});
