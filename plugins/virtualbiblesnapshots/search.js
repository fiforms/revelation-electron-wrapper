// plugins/virtualbiblesnapshots/search.js
const language = navigator.language.slice(0, 2);
window.translationsources ||= [];
window.translationsources.push(new URL('./locales/translations.json', window.location.href).pathname);
if (typeof window.loadTranslations === 'function') {
  await window.loadTranslations();
}
if (typeof window.translatePage === 'function') {
  window.translatePage(language);
}
const t = (key) => (typeof window.tr === 'function' ? window.tr(key) : key);

const urlParams = new URLSearchParams(window.location.search);
const slug = urlParams.get('slug');
const mdFile = urlParams.get('md');
const returnKey = urlParams.get('returnKey');
const insertTarget = urlParams.get('insertTarget');
const returnTagType = urlParams.get('tagType') || 'normal';
const libraryOnly = slug && mdFile ? false : true;

const qEl = document.getElementById('q');
const grid = document.getElementById('grid');
const showallEl = document.getElementById('showall');
const filterxxEl = document.getElementById('filterxx');
const typeSel = document.getElementById('typefilter');
const collectionSel = document.getElementById('collectionfilter');
const folderToolbar = document.getElementById('folder-toolbar');
const folderUpBtn = document.getElementById('folder-up');
const folderCurrentEl = document.getElementById('folder-current');
const folderListEl = document.getElementById('folder-list');
const settingsToggle = document.getElementById('settings-toggle');
const settingsMenu = document.getElementById('settings-menu');
const helpButton = document.getElementById('help-btn');
let overlay = null;
qEl.placeholder = t('Search...');
settingsToggle.setAttribute('aria-label', t('Search options'));
settingsMenu.setAttribute('aria-label', t('Search options'));
helpButton.title = t('Help');

function getSidebarOffset() {
  const sidebar = document.querySelector('nav.sidebar');
  if (!sidebar) return 0;
  return Math.max(0, Math.round(sidebar.getBoundingClientRect().right));
}

function applySidebarLayoutOffset() {
  const offset = getSidebarOffset();
  document.documentElement.style.setProperty('--vbs-left-offset', `${offset}px`);
  // Avoid the default sidebar.js extra gap (360px). This page manages its own offsets.
  document.body.style.paddingLeft = '0px';
}

applySidebarLayoutOffset();
window.addEventListener('resize', applySidebarLayoutOffset);
const sidebarOffsetObserver = new MutationObserver(() => {
  applySidebarLayoutOffset();
});
sidebarOffsetObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['style', 'class']
});

let sort = 'date';
document.querySelectorAll('input[name="sort"]').forEach(r => r.addEventListener('change', e => { sort = e.target.value; reSort(); }));

let insertMode = 'media'; // default

function setInsertMode(mode) {
  insertMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === 'mode-' + mode);
  });
}

if (libraryOnly) {
  document.getElementById('insert-buttons').style.display = 'none';
  document.getElementById('library-only-buttons').style.display = 'none';
}
if (returnKey) {
  document.getElementById('insert-buttons').style.display = 'none';
  document.getElementById('library-only-buttons').style.display = 'none';
}

// Bind click handlers
document.getElementById('mode-remote').addEventListener('click', () => setInsertMode('remote'));
document.getElementById('mode-inline').addEventListener('click', () => setInsertMode('inline'));
document.getElementById('mode-media').addEventListener('click', () => setInsertMode('media'));
document.getElementById('save-to-media').addEventListener('click', () => setInsertMode('save'));

// Initialize default
setInsertMode(libraryOnly ? 'save' : 'media');

let all = [];
let filtered = [];
let typelist = new Set();
let collectionTree = {};
let collectionPath = [];
let collections = [];
const collectionLabels = {
  videos: t('Video Collection'),
  thumbs: t('Main Collection'),
  illustrations: t('Illustration Collection')
};

qEl.addEventListener('input', redraw);
showallEl.addEventListener('change', redraw);
filterxxEl.addEventListener('change', redraw);
typeSel.addEventListener('change', redraw);
collectionSel.addEventListener('change', () => {
  collectionPath = [];
  redraw();
  renderFolderToolbar();
});
folderUpBtn.addEventListener('click', () => {
  if (!collectionPath.length) return;
  collectionPath.pop();
  redraw();
  renderFolderToolbar();
});

function getRowPath(row) {
  return row.path || row.dir || '';
}

function getPathSegments(path) {
  if (!path) return [];
  return path.split('/').filter(seg => seg.length > 0);
}

function addToCollectionTree(collectionId, path) {
  if (!collectionId) return;
  if (!collectionTree[collectionId]) {
    collectionTree[collectionId] = { children: {} };
  }
  const segments = getPathSegments(path);
  if (!segments.length) return;
  let node = collectionTree[collectionId];
  for (const segment of segments) {
    if (!node.children[segment]) node.children[segment] = { children: {} };
    node = node.children[segment];
  }
}

function getCurrentFolderNode() {
  const collectionId = collectionSel.value;
  if (!collectionId || !collectionTree[collectionId]) return null;
  let node = collectionTree[collectionId];
  for (const segment of collectionPath) {
    if (!node.children || !node.children[segment]) return null;
    node = node.children[segment];
  }
  return node;
}

function matchesCollectionFilter(row) {
  const collectionId = collectionSel.value;
  if (!collectionId) return true;
  if (row.collectionId !== collectionId) return false;
  if (!collectionPath.length) return true;
  const segments = getPathSegments(getRowPath(row));
  if (segments.length < collectionPath.length) return false;
  for (let i = 0; i < collectionPath.length; i++) {
    if (segments[i] !== collectionPath[i]) return false;
  }
  return true;
}

function renderFolderToolbar() {
  const collectionId = collectionSel.value;
  if (!collectionId) {
    folderToolbar.style.display = 'none';
    return;
  }
  folderToolbar.style.display = 'flex';
  folderUpBtn.style.visibility = collectionPath.length ? 'visible' : 'hidden';
  folderCurrentEl.textContent = collectionPath.length ? collectionPath.join(' / ') : t('All Folders');

  const node = getCurrentFolderNode();
  const folders = node && node.children ? Object.keys(node.children).sort((a,b) => a.localeCompare(b)) : [];
  folderListEl.innerHTML = folders.map(f => `<button class="folder-button" type="button" data-folder="${f}">${f}</button>`).join('');
}

folderListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-folder]');
  if (!btn) return;
  const folder = btn.dataset.folder;
  if (!folder) return;
  collectionPath.push(folder);
  redraw();
  renderFolderToolbar();
});

function setSettingsOpen(open) {
  if (!settingsMenu || !settingsToggle) return;
  settingsMenu.classList.toggle('open', open);
  settingsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

settingsToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  setSettingsOpen(!settingsMenu.classList.contains('open'));
});

if (helpButton) {
  helpButton.addEventListener('click', () => {
    if (!window.electronAPI?.openHandoutView) {
      window.alert(t('Help is only available in the desktop app.'));
      return;
    }
    window.electronAPI.openHandoutView('readme', 'plugins-virtualbiblesnapshots-readme.md').catch((err) => {
      console.error(err);
      window.alert(`${t('Failed to open help:')} ${err.message || err}`);
    });
  });
}

document.addEventListener('click', (e) => {
  if (!settingsMenu.classList.contains('open')) return;
  if (settingsMenu.contains(e.target) || settingsToggle.contains(e.target)) return;
  setSettingsOpen(false);
});

async function load() {
  // Pull all libraries you want to expose
  const config = await window.electronAPI.getAppConfig();
  const apiBase = (config.pluginConfigs?.virtualbiblesnapshots?.apiBase) || 'https://content.vrbm.org';
  const librariesCSV = (config.pluginConfigs?.virtualbiblesnapshots?.libraries) || '/videos,/thumbs,/illustrations';
  const libs = librariesCSV.split(',').map(s => s.trim()).filter(Boolean);

  // Your VUE app loads local /videos/snapshots.json etc. Here we fetch from content.vrbm.org
  // Expected JSON format matches your existing fields: filename, desc, md5, date, dir, arttype, license, attribution, ftype, medurl, largeurl, sourceurl
  const data = [];
  collections = [];
  for (const lib of libs) {
    const url = `${apiBase}${lib}/snapshots.json`;
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`Fetch failed: ${url}`);
    const rows = await res.json();
    const libName = lib.replace(/^\//, ''); // remove leading slash
    rows.forEach(row => {
      // Keep local md5/letter logic, but make absolute URLs
      const base = apiBase.replace(/\/$/, ''); // remove trailing slash
      row.src = `${base}/${libName}`;
      row.collectionId = libName;
      row.letter = (row.md5 || '').substring(0, 1);
      if (row.arttype) typelist.add(row.arttype);
      addToCollectionTree(libName, getRowPath(row));
      data.push(row);
    });
    collections.push({ id: libName, label: collectionLabels[libName] || libName });
  }
  all = data;
  buildTypeList();
  buildCollectionList();
  reSort();
  redraw();
  renderFolderToolbar();
}

function buildTypeList() {
  typeSel.innerHTML = `<option value="">${t('Filter by Type')}</option>` + [...typelist].sort().map(type => `<option>${type}</option>`).join('');
}

function buildCollectionList() {
  const options = collections.map(c => `<option value="${c.id}">${c.label}</option>`).join('');
  collectionSel.innerHTML = `<option value="">${t('Collection')}</option>` + options;
}

function matchRow(row, terms) {
  if (filterxxEl.checked && row.xx === 'XX') return false;
  return terms.every(t =>
    (row.dir && row.dir.toLowerCase().includes(t)) ||
    (row.filename && row.filename.toLowerCase().includes(t)) ||
    (row.desc && row.desc.toLowerCase().includes(t))
  );
}

function reSort() {
  all.sort((a,b) => {
    if (sort === 'path') return a.dir === b.dir ? (a.filename < b.filename ? -1 : 1) : (a.dir < b.dir ? -1 : 1);
    if (sort === 'date') return (a.date || '') > (b.date || '') ? -1 : 1;
    return Math.random() - 0.5;
  });
}

function redraw() {
  const term = qEl.value.trim().toLowerCase();
  const terms = term ? term.split(/\s+/) : [];
  const showAll = showallEl.checked;

  let results = [];
  let count = 0;

  for (const row of all) {
    if (term && term.length >= 3 ? matchRow(row, terms) : !term) {
      if ((!typeSel.value || row.arttype === typeSel.value) && matchesCollectionFilter(row)) {
        results.push(row);
        count++;
        if (!showAll && count >= 100) break;
      }
    }
  }

  filtered = results;
  renderGrid();
}

function renderGrid() {
  if (!filtered.length) {
    grid.innerHTML = `<p style="padding:12px;color:#aaa">${t('No results.')}</p>`;
    return;
  }
  grid.innerHTML = filtered.map(row => {
    const thumb = row.md5 ? `${row.src}/${row.letter}/${row.md5}.webp` : (row.medurl || row.largeurl || '');
    const isVideo = row.ftype === 'video';
    return `
      <div class="card" data-id="${row.md5 || row.medurl || row.largeurl}">
        <img src="${thumb}" alt="${(row.filename||'') + ' ' + (row.desc||'')}" />
        ${isVideo ? '<div class="video-badge">▶</div>' : ''}
      </div>
    `;
  }).join('');

  [...grid.querySelectorAll('.card')].forEach((el, idx) => {
    el.addEventListener('click', () => openLightbox(filtered[idx], idx));
  });
}

function setOverlay(message) {
  overlay = document.createElement('div');
  overlay.id = 'loading-overlay';
  overlay.textContent = message;
  overlay.style = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,0.6);color:#fff;
    display:flex;align-items:center;justify-content:center;
    font-size:1.5rem;z-index:9999;
  `;
  document.body.appendChild(overlay);
}

function clearOverlay(message) {
  overlay.remove();
}


async function choose(item) {
  setOverlay(t('Importing...'));
  let success = false;
  try {
    if (returnKey) {
      const res = await window.electronAPI.pluginTrigger('virtualbiblesnapshots', 'fetch-to-presentation', {
        slug,
        item
      });
      if (!res?.success) throw new Error(res?.error || t('Unknown error'));
      localStorage.setItem(returnKey, JSON.stringify({
        mode: 'file',
        filename: res.filename,
        encoded: res.encoded,
        attrib: res.attrib || '',
        ai: res.ai || false,
        tagType: returnTagType,
        insertTarget
      }));
      window.close();
      return;
    }

    const res = await window.electronAPI.pluginTrigger('virtualbiblesnapshots', 'fetch-to-media-library', {
      item
    });
    if (!res?.success) throw new Error(res?.error || t('Unknown error'));
    success = true;
  } catch (err) {
    alert(`${t('Failed to insert:')} ${err.message}`);
    console.error(err);
    clearOverlay();
    return;
  }
  if (success) {
    clearOverlay();
    setOverlay(t('Import Succeeded'));
    setTimeout(clearOverlay, 2000);
  }
}

load().catch(err => {
  grid.innerHTML = `<p style="color:#f66;padding:12px">${t('Error:')} ${err.message}</p>`;
});

document.addEventListener('DOMContentLoaded', () => {
  const suggestContainer = document.getElementById('search-suggest');
  const input = document.getElementById('q');

  suggestContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-term]');
    if (!btn) return; // ignore clicks outside buttons

    const term = btn.dataset.term || btn.textContent.trim();
    input.value = term;
    input.dispatchEvent(new Event('input')); // trigger your normal search logic

    // Optional: visual feedback
    document.querySelectorAll('.mode-search.active').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

function openLightbox(item, startIndex = -1) {
  const list = filtered.length ? filtered : [item];
  let currentIndex = startIndex >= 0 ? startIndex : Math.max(0, list.indexOf(item));
  if (currentIndex < 0) currentIndex = 0;

  // Create overlay
  const overlay = document.createElement('div');
  overlay.style = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.9);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    z-index: 9999;
  `;

  const closeLightbox = () => {
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', t('Close preview'));
  closeBtn.style = `
    position: fixed;
    top: 16px;
    right: 16px;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.35);
    background: rgba(0,0,0,0.55);
    color: #fff;
    font-size: 24px;
    line-height: 34px;
    text-align: center;
    cursor: pointer;
    z-index: 10000;
  `;
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeLightbox();
  });

  const makeNavButton = (label, side) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.setAttribute('aria-label', side === 'left' ? t('Previous item') : t('Next item'));
    btn.style = `
      position: fixed;
      top: 50%;
      ${side}: 16px;
      transform: translateY(-50%);
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.25);
      background: rgba(120,120,120,0.22);
      color: #eee;
      font-size: 22px;
      line-height: 36px;
      text-align: center;
      cursor: pointer;
      z-index: 10000;
    `;
    return btn;
  };

  const prevBtn = makeNavButton('‹', 'left');
  const nextBtn = makeNavButton('›', 'right');

  // Inner container
  const inner = document.createElement('div');
  inner.style = `
    max-width: 90vw; max-height: 90vh;
    display: flex; flex-direction: column;
    align-items: center; gap: 1rem;
    color: #eee;
    text-align: center;
  `;

  const mediaSlot = document.createElement('div');
  mediaSlot.style = 'max-height:70vh;display:flex;align-items:center;justify-content:center;';

  // Caption and import button
  const caption = document.createElement('div');

  const importBtn = document.createElement('button');
  importBtn.textContent = `📥 ${t('Import')}`;
  importBtn.style = `
    padding: 0.5rem 1rem; border-radius: 8px;
    border: 1px solid #666; background: #333; color: white;
    cursor: pointer;
  `;

  function renderCurrent() {
    const currentItem = list[currentIndex];
    const fullUrl = currentItem.medurl || currentItem.largeurl;
    mediaSlot.innerHTML = '';

    const isVideo = currentItem.ftype === 'video';
    const mediaEl = document.createElement(isVideo ? 'video' : 'img');
    mediaEl.src = fullUrl;
    mediaEl.style.maxHeight = '70vh';
    mediaEl.style.maxWidth = '90vw';
    if (isVideo) {
      mediaEl.controls = true;
      mediaEl.autoplay = true;
    }
    mediaSlot.appendChild(mediaEl);

    caption.innerHTML = `
      <strong>${currentItem.desc || currentItem.filename || t('Untitled')}</strong><br>
      <small>${currentItem.attribution || ''}</small><br>
      <small><a href="${currentItem.meddirlink}">${currentItem.dir || ''} ${t('(medium)')}</a> <a href="${currentItem.bigdirlink}">${t('(large)')}</a></small>
    `;

    importBtn.onclick = () => {
      closeLightbox();
      choose(currentItem);
    };
  }

  function move(delta) {
    if (!list.length) return;
    currentIndex = (currentIndex + delta + list.length) % list.length;
    renderCurrent();
  }

  function onKeyDown(e) {
    if (!document.body.contains(overlay)) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeLightbox();
    }
  }

  prevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    move(-1);
  });
  nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    move(1);
  });

  renderCurrent();
  inner.append(mediaSlot, caption, importBtn);
  overlay.append(inner, closeBtn, prevBtn, nextBtn);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeLightbox();
  });
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);
}
