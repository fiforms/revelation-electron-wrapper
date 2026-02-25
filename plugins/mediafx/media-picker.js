// js/media-library.js
import { initMediaLibrary } from '/js/media-core.js';
window.translationsources ||= [];
window.translationsources.push(new URL('./locales/translations.json', window.location.href).pathname);
if (typeof window.loadTranslations === 'function') {
  await window.loadTranslations();
}
if (typeof window.translatePage === 'function') {
  window.translatePage(navigator.language.slice(0, 2));
}
const t = (key) => (typeof window.tr === 'function' ? window.tr(key) : key);

const container = document.getElementById('media-grid-container'); 
const urlParams = new URLSearchParams(window.location.search);
const url_key = urlParams.get('key');

const backLink = document.getElementById('back-link');
if (url_key && backLink) {
  const a = document.createElement('a');
  a.href = `/presentations.html?key=${url_key}`;
  a.textContent = `\u2190 ${t('Back to Presentations')}`;
  a.style = 'color:#4da6ff;text-decoration:none;font-size:1rem;';
  a.onmouseover = () => a.style.textDecoration = 'underline';
  a.onmouseout = () => a.style.textDecoration = 'none';
  backLink.appendChild(a);
}

  const slug = urlParams.get('slug');
  const mdFile = urlParams.get('md');
  const tagType = urlParams.get('tag') || 'normal';
  const isPickerMode = slug && mdFile;


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
    if (!params || !params.item) {
      window.close();
      return;
    }

    const item = params.item; // from selected media

    try {
      const result = await window.electronAPI.pluginTrigger('mediafx', 'insertSelectedMedia', { item });

      if (result?.success) {
        window.close();
        return;
      }
      if (!result?.success) {
        alert(`⚠️ ${result?.error || t('Something went wrong.')}`);
      }
    } catch (err) {
      console.error(err);
      alert(`❌ ${t('Error:')} ${err.message}`);
    }
  }
});
