// js/media-library.js
import { initMediaLibrary } from '/js/media-core.js';

const container = document.getElementById('media-grid-container'); // existing div in media-library.html
const urlParams = new URLSearchParams(window.location.search);
const url_key = urlParams.get('key');

const backLink = document.getElementById('back-link');
if (url_key && backLink) {
  const a = document.createElement('a');
  a.href = `/presentations.html?key=${url_key}`;
  a.textContent = '← Back to Presentations';
  a.style = 'color:#4da6ff;text-decoration:none;font-size:1rem;';
  a.onmouseover = () => a.style.textDecoration = 'underline';
  a.onmouseout = () => a.style.textDecoration = 'none';
  backLink.appendChild(a);
}

  const slug = urlParams.get('slug');
  const mdFile = urlParams.get('md') || 'presentation.md';
  const tagType = urlParams.get('tag') || 'normal';
  const isPickerMode = slug && mdFile;
  const selectionKey = `addmedia:selected:${slug || 'unknown'}:${mdFile}`;


// Vite HMR hook (unchanged)
if (import.meta.hot) {
  import.meta.hot.on('reload-media', () => location.reload());
}

if(window.electronAPI) {
  const linkBack = document.getElementById('back-link');
  if(linkBack) linkBack.style.display = 'none';
}

initMediaLibrary(container, { 
  key: url_key, 
  mode: 'picker', 
  onPick: async (params) => {
    const item = params.item; // from selected media

    try {
      if (!isPickerMode) return;
      const payload = { slug, mdFile, tagType, item, ts: Date.now() };
      localStorage.setItem(selectionKey, JSON.stringify(payload));
      window.close();
    } catch (err) {
      console.error(err);
      alert(`❌ Error: ${err.message}`);
    }
  }
});
