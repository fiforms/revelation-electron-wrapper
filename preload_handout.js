const { ipcRenderer } = require('electron');

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
});
