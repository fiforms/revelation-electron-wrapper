// plugins/virtualbiblesnapshots/search.js
const urlParams = new URLSearchParams(window.location.search);
const slug = urlParams.get('slug');
const mdFile = urlParams.get('md');
const libraryOnly = slug && mdFile ? false : true;

const qEl = document.getElementById('q');
const grid = document.getElementById('grid');
const showallEl = document.getElementById('showall');
const filterxxEl = document.getElementById('filterxx');
const typeSel = document.getElementById('typefilter');
let overlay = null;

let sort = 'path';
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
  document.getElementById('library-only-buttons').style.display = 'block';
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

qEl.addEventListener('input', redraw);
showallEl.addEventListener('change', redraw);
filterxxEl.addEventListener('change', redraw);
typeSel.addEventListener('change', redraw);

async function load() {
  // Pull all libraries you want to expose
  const config = await window.electronAPI.getAppConfig();
  const apiBase = (config.pluginConfigs?.virtualbiblesnapshots?.apiBase) || 'https://content.vrbm.org';
  const librariesCSV = (config.pluginConfigs?.virtualbiblesnapshots?.libraries) || '/videos,/thumbs,/illustrations';
  const libs = librariesCSV.split(',').map(s => s.trim()).filter(Boolean);

  // Your VUE app loads local /videos/snapshots.json etc. Here we fetch from content.vrbm.org
  // Expected JSON format matches your existing fields: filename, desc, md5, date, dir, arttype, license, attribution, ftype, medurl, largeurl, sourceurl
  const data = [];
  for (const lib of libs) {
    const url = `${apiBase}${lib}/snapshots.json`;
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`Fetch failed: ${url}`);
    const rows = await res.json();
    rows.forEach(row => {
      // Keep local md5/letter logic, but make absolute URLs
      const base = apiBase.replace(/\/$/, ''); // remove trailing slash
      const libName = lib.replace(/^\//, ''); // remove leading slash
      row.src = `${base}/${libName}`;
      row.letter = (row.md5 || '').substring(0, 1);
      if (row.arttype) typelist.add(row.arttype);
      data.push(row);
    });
  }
  all = data;
  buildTypeList();
  reSort();
  redraw();
}

function buildTypeList() {
  typeSel.innerHTML = '<option value="">Filter by Type</option>' + [...typelist].sort().map(t => `<option>${t}</option>`).join('');
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
      if (!typeSel.value || row.arttype === typeSel.value) {
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
    grid.innerHTML = '<p style="padding:12px;color:#aaa">No results.</p>';
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
    el.addEventListener('click', () => openLightbox(filtered[idx]));
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
  setOverlay('Importing...');
  try {
    const res = await window.electronAPI.pluginTrigger('virtualbiblesnapshots', 'insert-selected', {
      slug, 
      mdFile, 
      item, 
      insertMode  
    });
    if (!res?.success) throw new Error(res?.error || 'Unknown error');
    //window.close();
  } catch (err) {
    alert('Failed to insert: ' + err.message);
    console.error(err);
  }
  clearOverlay();
  setOverlay('Import Succeeded');
  setTimeout(clearOverlay, 2000);
}

load().catch(err => {
  grid.innerHTML = `<p style="color:#f66;padding:12px">Error: ${err.message}</p>`;
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

function openLightbox(item) {
  const fullUrl = item.medurl || item.largeurl;

  // Create overlay
  const overlay = document.createElement('div');
  overlay.style = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.9);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    z-index: 9999;
  `;

  // Inner container
  const inner = document.createElement('div');
  inner.style = `
    max-width: 90vw; max-height: 90vh;
    display: flex; flex-direction: column;
    align-items: center; gap: 1rem;
    color: #eee;
    text-align: center;
  `;

  // Media preview
  const isVideo = item.ftype === 'video';
  const mediaEl = document.createElement(isVideo ? 'video' : 'img');
  mediaEl.src = fullUrl;
  mediaEl.style.maxHeight = '70vh';
  if (isVideo) {
    mediaEl.controls = true;
    mediaEl.autoplay = true;
  }

  // Caption and import button
  const caption = document.createElement('div');
  caption.innerHTML = `
    <strong>${item.desc || item.filename || 'Untitled'}</strong><br>
    <small>${item.attribution || ''}</small><br>
    <small><a href="${item.meddirlink}">${item.dir || ''} (medium)</a> <a href="${item.bigdirlink}">(large)</a></small>
  `;

  const importBtn = document.createElement('button');
  importBtn.textContent = '📥 Import';
  importBtn.style = `
    padding: 0.5rem 1rem; border-radius: 8px;
    border: 1px solid #666; background: #333; color: white;
    cursor: pointer;
  `;
  importBtn.addEventListener('click', () => {
    overlay.remove();
    choose(item); // call your existing import logic
  });

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✖ Close';
  closeBtn.style = `
    margin-top: .5rem;
    background: transparent;
    color: #aaa;
    border: none;
    cursor: pointer;
  `;
  closeBtn.addEventListener('click', () => overlay.remove());

  inner.append(mediaEl, caption, importBtn, closeBtn);
  overlay.appendChild(inner);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

