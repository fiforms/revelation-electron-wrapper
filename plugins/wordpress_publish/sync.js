window.translationsources ||= [];
window.translationsources.push(new URL('./locales/translations.json', window.location.href).pathname);

const siteSelect = document.getElementById('siteSelect');
const refreshButton = document.getElementById('refreshButton');
const manageSitesButton = document.getElementById('manageSitesButton');
const filterInput = document.getElementById('filterInput');
const remoteList = document.getElementById('remoteList');
const emptyState = document.getElementById('emptyState');
const statusEl = document.getElementById('status');
const helpButton = document.getElementById('pairing-help-btn');

const LAST_SITE_KEY = 'wordpress_publish.sync.lastSite';

let pairings = [];
let presentations = [];
let busy = false;
let activeSyncSiteBaseUrl = '';

function t(key) {
  return typeof window.tr === 'function' ? window.tr(key) : key;
}

// Single-pass substitution so placeholder-like text in names is left alone.
function fill(template, values) {
  return template.replace(/XX|YY|ZZ|VV|WW|UU/g, (token) => (token in values ? values[token] : token));
}

function decodeHtmlEntities(value) {
  const raw = String(value || '');
  if (!raw || !raw.includes('&')) return raw;
  const el = document.createElement('textarea');
  el.innerHTML = raw;
  return el.value;
}

function setStatus(message, { error = false } = {}) {
  statusEl.textContent = String(message || '');
  statusEl.classList.toggle('error', !!error);
}

function formatDate(value) {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? new Date(ts).toLocaleString() : '';
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function closeAllMenus() {
  document.querySelectorAll('.menu-popup.open').forEach((menu) => menu.classList.remove('open'));
}

function currentSite() {
  return pairings.find((item) => item.siteBaseUrl === siteSelect.value) || null;
}

function siteLabel(site) {
  return decodeHtmlEntities(site?.siteName || site?.siteBaseUrl || t('WordPress site'));
}

function presentationUrlFor(item, mdFile) {
  try {
    const url = new URL(item.presentationUrl);
    if (mdFile) url.searchParams.set('p', mdFile);
    return url.toString();
  } catch {
    return item.presentationUrl;
  }
}

function setBusy(value) {
  busy = value;
  siteSelect.disabled = value;
  refreshButton.disabled = value;
  remoteList.querySelectorAll('button').forEach((button) => {
    button.disabled = value;
  });
}

function rememberSite(siteBaseUrl) {
  try {
    window.localStorage.setItem(LAST_SITE_KEY, siteBaseUrl);
  } catch {
    // Remembering the last site is a convenience only.
  }
}

function recallSite() {
  try {
    return window.localStorage.getItem(LAST_SITE_KEY) || '';
  } catch {
    return '';
  }
}

function renderSites() {
  siteSelect.innerHTML = '';
  for (const item of pairings) {
    const option = document.createElement('option');
    option.value = item.siteBaseUrl;
    option.textContent = `${siteLabel(item)} (${item.siteBaseUrl})`;
    siteSelect.appendChild(option);
  }
  const remembered = recallSite();
  if (pairings.some((item) => item.siteBaseUrl === remembered)) {
    siteSelect.value = remembered;
  }
}

function makeButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  if (className) button.className = className;
  button.textContent = label;
  button.disabled = busy;
  button.addEventListener('click', onClick);
  return button;
}

function renderList() {
  const query = filterInput.value.trim().toLowerCase();
  const visible = presentations.filter((item) => {
    if (!query) return true;
    return [item.title, item.slug, item.local?.slug].some((value) => String(value || '').toLowerCase().includes(query));
  });

  remoteList.innerHTML = '';
  if (!pairings.length) {
    emptyState.textContent = t('No sites paired yet. Use Manage Sites... to pair a WordPress site.');
  } else if (!presentations.length) {
    emptyState.textContent = t('No presentations are hosted on this site yet.');
  } else if (!visible.length) {
    emptyState.textContent = t('No presentations match the filter.');
  } else {
    emptyState.textContent = '';
  }
  emptyState.style.display = emptyState.textContent ? 'block' : 'none';

  for (const item of visible) {
    const li = document.createElement('li');
    li.className = 'paired-item';

    const left = document.createElement('div');
    const title = document.createElement('strong');
    title.className = 'row-title';
    const dot = document.createElement('span');
    dot.className = `dot ${item.local ? 'synced' : 'remote'}`;
    dot.title = item.local ? t('Synced locally') : t('Server only');
    const titleText = document.createElement('span');
    titleText.textContent = decodeHtmlEntities(item.title || item.slug);
    title.appendChild(dot);
    title.appendChild(titleText);

    const meta = document.createElement('small');
    const updated = formatDate(item.updatedAt);
    meta.textContent = [
      item.slug,
      fill(t('XX files, YY'), { XX: String(item.fileCount), YY: formatBytes(item.totalBytes) }),
      updated ? fill(t('updated XX'), { XX: updated }) : ''
    ].filter(Boolean).join(' · ');

    left.appendChild(title);
    left.appendChild(meta);

    if (item.local) {
      const localMeta = document.createElement('small');
      const synced = formatDate(item.local.lastSyncedAt);
      const parts = [fill(t('Local: XX'), { XX: item.local.slug })];
      if (item.local.linkedBy === 'id') {
        parts.push(t('matched by presentation ID, not synced from here yet'));
      } else if (synced) {
        parts.push(fill(t('last synced XX'), { XX: synced }));
      }
      localMeta.textContent = parts.join(' · ');
      left.appendChild(localMeta);
    }

    const actions = document.createElement('div');
    actions.className = 'paired-actions';
    actions.appendChild(item.local
      ? makeButton(t('Sync'), 'publish-btn', () => syncPresentation(item))
      : makeButton(t('Import'), 'import-btn', () => importRemotePresentation(item)));

    const menuWrap = document.createElement('div');
    menuWrap.className = 'menu-wrap';
    const menuBtn = makeButton('...', 'menu-btn secondary', (event) => {
      event.stopPropagation();
      const open = menu.classList.contains('open');
      closeAllMenus();
      if (!open) menu.classList.add('open');
    });
    const menu = document.createElement('div');
    menu.className = 'menu-popup';

    const mdFiles = item.mdFiles.length ? item.mdFiles : [''];
    for (const mdFile of mdFiles) {
      const label = mdFiles.length > 1 ? fill(t('Open XX'), { XX: mdFile }) : t('Open Remote Presentation');
      menu.appendChild(makeButton(label, '', async () => {
        closeAllMenus();
        await openRemote(item, mdFile);
      }));
    }
    const copyBtn = makeButton(t('Copy Remote Presentation Link'), '', async () => {
      closeAllMenus();
      await copyLink(item, copyBtn);
    });
    menu.appendChild(copyBtn);

    menuWrap.appendChild(menuBtn);
    menuWrap.appendChild(menu);
    actions.appendChild(menuWrap);

    li.appendChild(left);
    li.appendChild(actions);
    remoteList.appendChild(li);
  }
}

async function loadPresentations({ quiet = false } = {}) {
  const site = currentSite();
  presentations = [];
  if (!site) {
    renderList();
    return;
  }
  rememberSite(site.siteBaseUrl);
  if (!quiet) setStatus(fill(t('Loading presentations from XX...'), { XX: siteLabel(site) }));
  setBusy(true);
  try {
    const result = await window.electronAPI.pluginTrigger('wordpress_publish', 'list-remote-presentations', {
      siteBaseUrl: site.siteBaseUrl
    });
    if (!result || result.success !== true) {
      throw new Error(result?.error || t('Failed to list hosted presentations.'));
    }
    presentations = Array.isArray(result.presentations) ? result.presentations : [];
    if (!quiet) {
      const syncedCount = presentations.filter((item) => item.local).length;
      setStatus(fill(t('XX presentations on YY, ZZ synced locally.'), {
        XX: String(presentations.length),
        YY: siteLabel(site),
        ZZ: String(syncedCount)
      }));
    }
  } catch (err) {
    setStatus(err.message || t('Failed to list hosted presentations.'), { error: true });
  } finally {
    setBusy(false);
    renderList();
  }
}

async function syncPresentation(item) {
  const site = currentSite();
  if (!site || !item.local || busy) return;
  if (String(site.siteBaseUrl).toLowerCase().startsWith('http://')) {
    const proceed = window.confirm(
      t('This WordPress site uses HTTP only. Publish tokens and presentation content can be intercepted or replayed on the network. Continue anyway?')
    );
    if (!proceed) return;
  }

  setBusy(true);
  activeSyncSiteBaseUrl = site.siteBaseUrl;
  setStatus(fill(t('Syncing XX with YY...'), { XX: item.local.slug, YY: siteLabel(site) }));
  let refresh = false;
  try {
    const result = await window.electronAPI.pluginTrigger('wordpress_publish', 'publish-presentation', {
      siteBaseUrl: site.siteBaseUrl,
      slug: item.local.slug,
      mdFile: item.local.mdFile,
      targetRemoteSlug: item.slug
    });
    if (!result || result.success !== true) {
      throw new Error(result?.error || t('Publish failed in desktop plugin.'));
    }
    let message = fill(t('Synced XX: uploaded YY, downloaded ZZ.'), {
      XX: item.local.slug,
      YY: String(Number(result.uploadedCount || 0)),
      ZZ: String(Number(result.pulledCount || 0))
    });
    if (Number(result.conflictCount || 0) > 0) {
      message += ` ${fill(t('Resolved XX conflict(s); the other versions were saved in YY.'), {
        XX: String(result.conflictCount),
        YY: String(result.conflictBackupDir || '.sync-conflicts')
      })}`;
    }
    const rejected = Array.isArray(result.rejectedFiles) ? result.rejectedFiles : [];
    if (rejected.length) {
      const extensions = [...new Set(rejected.map((name) => {
        const idx = name.lastIndexOf('.');
        return idx > 0 ? name.slice(idx + 1).toLowerCase() : name;
      }))].join(', ');
      message += ` ${fill(t('Warning: the site refused XX file(s) (YY). Add these extensions to "Allowed File Extensions" in the WordPress plugin settings, then publish again.'), {
        XX: String(rejected.length),
        YY: extensions
      })}`;
    }
    setStatus(message, { error: rejected.length > 0 });
    refresh = true;
  } catch (err) {
    setStatus(err.message || t('Publish failed in desktop plugin.'), { error: true });
  } finally {
    activeSyncSiteBaseUrl = '';
    setBusy(false);
  }
  if (refresh) await loadPresentations({ quiet: true });
}

async function importRemotePresentation(item) {
  const site = currentSite();
  if (!site || busy) return;
  setBusy(true);
  setStatus(fill(t('Importing XX from YY...'), { XX: decodeHtmlEntities(item.title || item.slug), YY: siteLabel(site) }));
  let refresh = false;
  try {
    const result = await window.electronAPI.pluginTrigger('wordpress_publish', 'import-remote-presentation', {
      siteBaseUrl: site.siteBaseUrl,
      presentationUrl: item.presentationUrl,
      remoteSlug: item.slug
    });
    if (result?.canceled) {
      setStatus(result.error || t('Import cancelled.'), { error: true });
    } else if (!result || result.success !== true) {
      throw new Error(result?.error || t('Import failed.'));
    } else {
      setStatus(fill(t('Imported XX as local presentation YY.'), {
        XX: decodeHtmlEntities(item.title || item.slug),
        YY: String(result.slug || '')
      }));
      refresh = true;
    }
  } catch (err) {
    setStatus(err.message || t('Import failed.'), { error: true });
  } finally {
    setBusy(false);
  }
  if (refresh) await loadPresentations({ quiet: true });
}

async function openRemote(item, mdFile) {
  try {
    await window.electronAPI.openPresentation(presentationUrlFor(item, mdFile), null, false, {
      forcePresentationPreload: true
    });
  } catch (err) {
    setStatus(err.message || t('Failed to open remote presentation.'), { error: true });
  }
}

async function copyLink(item, button) {
  const url = presentationUrlFor(item, item.mdFiles[0] || '');
  try {
    await navigator.clipboard.writeText(url);
    const oldText = button.textContent;
    button.textContent = t('Copied');
    window.setTimeout(() => {
      button.textContent = oldText;
    }, 1200);
  } catch (err) {
    setStatus(err.message || t('Failed to copy remote presentation link.'), { error: true });
  }
}

window.electronAPI?.onPluginProgress?.((payload = {}) => {
  if (payload?.plugin !== 'wordpress_publish' || payload?.action !== 'publish-presentation') return;
  if (!activeSyncSiteBaseUrl || String(payload.siteBaseUrl || '') !== activeSyncSiteBaseUrl) return;
  const counter = payload.count ? ` (${Number(payload.index || 0)}/${Number(payload.count)})` : '';
  const template = payload.phase === 'download'
    ? t('Syncing with XX... downloading YYZZ')
    : t('Syncing with XX... uploading YYZZ');
  setStatus(fill(template, {
    XX: siteLabel(currentSite()),
    YY: String(payload.filename || ''),
    ZZ: counter
  }));
});

async function refreshPairings() {
  try {
    const result = await window.electronAPI.pluginTrigger('wordpress_publish', 'get-pairings', {});
    pairings = Array.isArray(result?.pairings) ? result.pairings : [];
  } catch (err) {
    pairings = [];
    setStatus(err.message || t('Failed to load pairings.'), { error: true });
  }
  renderSites();
}

async function initPage() {
  const language = navigator.language.slice(0, 2);
  if (typeof window.translatePage === 'function') {
    window.translatePage(language);
  }
  filterInput.placeholder = t('Filter presentations');
  await refreshPairings();
  await loadPresentations();
}

document.addEventListener('click', () => closeAllMenus());
siteSelect.addEventListener('change', () => loadPresentations());
refreshButton.addEventListener('click', async () => {
  await refreshPairings();
  await loadPresentations();
});
filterInput.addEventListener('input', () => renderList());
manageSitesButton.addEventListener('click', () => {
  window.electronAPI.pluginTrigger('wordpress_publish', 'open-pairing-window', {}).catch((err) => {
    setStatus(err.message || t('Pairing window failed to open:'), { error: true });
  });
});
helpButton?.addEventListener('click', () => {
  window.electronAPI?.openHandoutView('readme', 'plugins-wordpress_publish-readme.md').catch((err) => {
    window.alert(`Failed to open help: ${err.message || err}`);
  });
});

if (window.translationsLoaded) {
  initPage();
} else {
  window.addEventListener('translations-loaded', () => {
    initPage().catch((err) => {
      console.warn('[wordpress_publish] failed to initialize sync window:', err);
    });
  }, { once: true });
}
