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
  const mdFile = urlParams.get('md');
  const tagType = urlParams.get('tag') || 'normal';
  const isPickerMode = slug && mdFile;


// Vite HMR hook (unchanged)
if (import.meta.hot) {
  import.meta.hot.on('reload-media', () => location.reload());
}

//FIXME:
initMediaLibrary(container, { key: url_key, mode: 'picker', onPick: (params) => {
    alert(JSON.stringify(params.yaml));
}});
