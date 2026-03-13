window.translationsources ||= [];
window.translationsources.push(new URL('./locales/translations.json', window.location.href).pathname);

const pairingUrlInput = document.getElementById('pairingUrlInput');
const pairButton = document.getElementById('pairButton');
const statusEl = document.getElementById('status');
const pairedList = document.getElementById('pairedList');
const emptyState = document.getElementById('emptyState');
const publishTargetEl = document.getElementById('publishTarget');
const pairingHelpButton = document.getElementById('pairing-help-btn');
let activeMediaSyncSiteBaseUrl = '';
let activeMediaSyncSiteLabel = '';

function t(key) {
  return typeof window.tr === 'function' ? window.tr(key) : key;
}

const urlParams = new URLSearchParams(window.location.search);
const currentPresentation = {
  slug: String(urlParams.get('slug') || '').trim(),
  mdFile: String(urlParams.get('md') || 'presentation.md').trim(),
  title: String(urlParams.get('title') || '').trim()
};

function decodeHtmlEntities(value) {
  const raw = String(value || '');
  if (!raw || !raw.includes('&')) return raw;
  const el = document.createElement('textarea');
  el.innerHTML = raw;
  return el.value;
}

function hasPublishContext() {
  return !!currentPresentation.slug;
}

function setPublishTargetLabel() {
  if (!publishTargetEl) return;
  if (!hasPublishContext()) {
    publishTargetEl.textContent = t('No presentation selected. Open this window from a presentation card to enable publishing.');
    return;
  }
  const title = decodeHtmlEntities(currentPresentation.title || currentPresentation.slug);
  publishTargetEl.textContent = t('Selected: XX (YY/ZZ)')
    .replace('XX', title)
    .replace('YY', currentPresentation.slug)
    .replace('ZZ', currentPresentation.mdFile);
}

function setStatus(message, { error = false } = {}) {
  statusEl.textContent = String(message || '');
  statusEl.classList.toggle('error', !!error);
}

function formatDate(value) {
  const ts = Date.parse(String(value || ''));
  if (!Number.isFinite(ts)) return value || '';
  return new Date(ts).toLocaleString();
}

function closeAllMenus() {
  document.querySelectorAll('.menu-popup.open').forEach((menu) => {
    menu.classList.remove('open');
  });
}

function isInsecureSiteUrl(value) {
  return String(value || '').trim().toLowerCase().startsWith('http://');
}

async function getRemotePresentationLink(item) {
  if (!hasPublishContext()) {
    throw new Error(t('No presentation selected to share.'));
  }

  const result = await window.electronAPI.pluginTrigger('wordpress_publish', 'get-remote-presentation-link', {
    siteBaseUrl: item.siteBaseUrl,
    slug: currentPresentation.slug,
    mdFile: currentPresentation.mdFile
  });
  if (!result || result.success !== true || !result.presentationUrl) {
    throw new Error(result?.error || t('Failed to resolve remote presentation link.'));
  }
  return result;
}

async function openRemotePresentation(item) {
  try {
    const result = await getRemotePresentationLink(item);
    await window.electronAPI.openPresentation(result.presentationUrl, null, false, {
      forcePresentationPreload: true
    });
    setStatus(
      t('Opened remote presentation on XX.')
        .replace('XX', decodeHtmlEntities(result.siteName || item.siteName || item.siteBaseUrl || t('WordPress site')))
    );
  } catch (err) {
    setStatus(err.message || t('Failed to open remote presentation.'), { error: true });
  }
}

async function copyRemotePresentationLink(item, button = null) {
  try {
    const result = await getRemotePresentationLink(item);
    const url = String(result.presentationUrl || '').trim();
    if (!url) {
      throw new Error(t('Failed to resolve remote presentation link.'));
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const temp = document.createElement('textarea');
      temp.value = url;
      temp.setAttribute('readonly', 'readonly');
      temp.style.position = 'fixed';
      temp.style.opacity = '0';
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
    }

    if (button) {
      const oldText = button.textContent;
      button.textContent = t('Copied');
      window.setTimeout(() => {
        button.textContent = oldText;
      }, 1200);
    }

    setStatus(
      t('Copied remote presentation link for XX.')
        .replace('XX', decodeHtmlEntities(result.siteName || item.siteName || item.siteBaseUrl || t('WordPress site')))
    );
  } catch (err) {
    setStatus(err.message || t('Failed to copy remote presentation link.'), { error: true });
  }
}

async function publishToSite(item, publishBtn) {
  if (!hasPublishContext()) {
    setStatus(t('No presentation selected to publish.'), { error: true });
    return;
  }

  if (isInsecureSiteUrl(item.siteBaseUrl)) {
    const proceed = window.confirm(
      t('This WordPress site uses HTTP only. Publish tokens and presentation content can be intercepted or replayed on the network. Continue anyway?')
    );
    if (!proceed) {
      setStatus(t('Publish cancelled. HTTPS is recommended.'), { error: true });
      return;
    }
  }

  publishBtn.disabled = true;
  setStatus(
    t('Publishing XX to YY...')
      .replace('XX', currentPresentation.slug)
      .replace('YY', decodeHtmlEntities(item.siteName || item.siteBaseUrl))
  );

  try {
    const result = await window.electronAPI.pluginTrigger('wordpress_publish', 'publish-presentation', {
      siteBaseUrl: item.siteBaseUrl,
      slug: currentPresentation.slug,
      mdFile: currentPresentation.mdFile
    });
    if (!result || result.success !== true) {
      throw new Error(result?.error || t('Publish failed in desktop plugin.'));
    }

    const siteName = decodeHtmlEntities(result?.siteName || item.siteName || item.siteBaseUrl || t('WordPress site'));
    const remoteSlug = String(result?.remoteSlug || currentPresentation.slug);
    const uploadedCount = Number(result?.uploadedCount || 0);
    const totalFiles = Number(result?.totalFiles || 0);
    const linkSuffix = result?.presentationUrl ? ` URL: ${result.presentationUrl}` : '';
    setStatus(
      t('Published to XX as YY. Uploaded ZZ/WW changed files.UU')
        .replace('XX', siteName)
        .replace('YY', remoteSlug)
        .replace('ZZ', String(uploadedCount))
        .replace('WW', String(totalFiles))
        .replace('UU', linkSuffix)
    );
  } catch (err) {
    setStatus(err.message || t('Publish failed in desktop plugin.'), { error: true });
  } finally {
    publishBtn.disabled = false;
  }
}

async function unpairSite(item) {
  try {
    const result = await window.electronAPI.pluginTrigger('wordpress_publish', 'remove-pairing', {
      siteBaseUrl: item.siteBaseUrl
    });
    renderPairings(result?.pairings || []);
    setStatus(t('Site unpaired.'));
  } catch (err) {
    setStatus(err.message || t('Failed to unpair site.'), { error: true });
  }
}

async function syncMediaLibrary(item) {
  try {
    activeMediaSyncSiteBaseUrl = String(item.siteBaseUrl || '');
    activeMediaSyncSiteLabel = decodeHtmlEntities(item.siteName || item.siteBaseUrl || t('WordPress site'));
    setStatus(
      t('Syncing media library to XX...')
        .replace('XX', activeMediaSyncSiteLabel)
    );
    const result = await window.electronAPI.pluginTrigger('wordpress_publish', 'sync-media-library', {
      siteBaseUrl: item.siteBaseUrl
    });
    if (!result || result.success !== true) {
      throw new Error(result?.error || t('Media library sync failed.'));
    }
    const uploadedCount = Number(result?.uploadedCount || 0);
    const neededFiles = Number(result?.neededFiles ?? result?.uploadedCount ?? 0);
    const indexSuffix = result?.sharedMediaIndexUrl ? ` URL: ${result.sharedMediaIndexUrl}` : '';
    setStatus(
      t('Media library synced to XX. Uploaded YY/ZZ changed files.UU')
        .replace('XX', decodeHtmlEntities(result?.siteName || item.siteName || item.siteBaseUrl || t('WordPress site')))
        .replace('YY', String(uploadedCount))
        .replace('ZZ', String(neededFiles))
        .replace('UU', indexSuffix)
    );
  } catch (err) {
    setStatus(err.message || t('Media library sync failed.'), { error: true });
  } finally {
    activeMediaSyncSiteBaseUrl = '';
    activeMediaSyncSiteLabel = '';
  }
}

window.electronAPI?.onPluginProgress?.((payload = {}) => {
  if (payload?.plugin !== 'wordpress_publish') return;
  if (payload?.action !== 'sync-media-library') return;
  if (!activeMediaSyncSiteBaseUrl) return;
  if (String(payload.siteBaseUrl || '') !== activeMediaSyncSiteBaseUrl) return;

  const siteLabel = activeMediaSyncSiteLabel || t('WordPress site');
  const uploadedFiles = Number(payload.uploadedFiles || 0);
  const neededFiles = Number(payload.neededFiles || 0);
  const totalFiles = Number(payload.totalFiles || 0);
  const filename = String(payload.filename || '').trim();

  if (payload.phase === 'start') {
    setStatus(
      t('Syncing media library to XX... YY/ZZ files uploaded (WW total).')
        .replace('XX', siteLabel)
        .replace('YY', '0')
        .replace('ZZ', String(neededFiles))
        .replace('WW', String(totalFiles))
    );
    return;
  }

  if (payload.phase === 'file') {
    const suffix = filename ? ` ${filename}` : '';
    setStatus(
      t('Syncing media library to XX... YY/ZZ files uploaded (WW total).UU')
        .replace('XX', siteLabel)
        .replace('YY', String(uploadedFiles))
        .replace('ZZ', String(neededFiles))
        .replace('WW', String(totalFiles))
        .replace('UU', suffix)
    );
  }
});

function renderPairings(pairings) {
  const list = Array.isArray(pairings) ? pairings : [];
  pairedList.innerHTML = '';
  emptyState.style.display = list.length ? 'none' : 'block';

  list.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'paired-item';

    const left = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = decodeHtmlEntities(item.siteName || item.siteBaseUrl || t('WordPress site'));
    const subtitle = document.createElement('small');
    const transportLabel = isInsecureSiteUrl(item.siteBaseUrl) ? t('HTTP only - insecure') : t('HTTPS');
    subtitle.textContent = `${item.siteBaseUrl || ''} (${item.authMode || t('unknown')}, ${transportLabel})`;
    const meta = document.createElement('small');
    meta.textContent = t('Paired: XX').replace('XX', formatDate(item.pairedAt));
    left.appendChild(title);
    left.appendChild(subtitle);
    left.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'paired-actions';

    const publishBtn = document.createElement('button');
    publishBtn.type = 'button';
    publishBtn.className = 'publish-btn';
    publishBtn.textContent = t('Publish');
    publishBtn.disabled = !hasPublishContext();
    publishBtn.addEventListener('click', () => publishToSite(item, publishBtn));

    const menuWrap = document.createElement('div');
    menuWrap.className = 'menu-wrap';

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'menu-btn secondary';
    menuBtn.textContent = '...';

    const menu = document.createElement('div');
    menu.className = 'menu-popup';

    const unpairBtn = document.createElement('button');
    unpairBtn.type = 'button';
    unpairBtn.textContent = t('Unpair');
    unpairBtn.addEventListener('click', async () => {
      closeAllMenus();
      await unpairSite(item);
    });

    const syncMediaBtn = document.createElement('button');
    syncMediaBtn.type = 'button';
    syncMediaBtn.textContent = t('Sync Media Library');
    syncMediaBtn.addEventListener('click', async () => {
      closeAllMenus();
      await syncMediaLibrary(item);
    });

    const openRemoteBtn = document.createElement('button');
    openRemoteBtn.type = 'button';
    openRemoteBtn.textContent = t('Open Remote Presentation');
    openRemoteBtn.disabled = !hasPublishContext();
    openRemoteBtn.addEventListener('click', async () => {
      closeAllMenus();
      await openRemotePresentation(item);
    });

    const copyRemoteBtn = document.createElement('button');
    copyRemoteBtn.type = 'button';
    copyRemoteBtn.textContent = t('Copy Remote Presentation Link');
    copyRemoteBtn.disabled = !hasPublishContext();
    copyRemoteBtn.addEventListener('click', async () => {
      closeAllMenus();
      await copyRemotePresentationLink(item, copyRemoteBtn);
    });

    menu.appendChild(openRemoteBtn);
    menu.appendChild(copyRemoteBtn);
    menu.appendChild(syncMediaBtn);
    menu.appendChild(unpairBtn);
    menuBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = menu.classList.contains('open');
      closeAllMenus();
      if (!open) menu.classList.add('open');
    });

    menuWrap.appendChild(menuBtn);
    menuWrap.appendChild(menu);

    actions.appendChild(publishBtn);
    actions.appendChild(menuWrap);

    li.appendChild(left);
    li.appendChild(actions);
    pairedList.appendChild(li);
  });
}

async function refreshPairings() {
  try {
    const result = await window.electronAPI.pluginTrigger('wordpress_publish', 'get-pairings', {});
    renderPairings(result?.pairings || []);
  } catch (err) {
    setStatus(err.message || t('Failed to load pairings.'), { error: true });
  }
}

async function pairCurrentSite() {
  const pairingUrl = pairingUrlInput.value.trim();
  pairingUrlInput.placeholder = t('https://example.org');

  if (!pairingUrl) {
    setStatus(t('Pairing URL is required.'), { error: true });
    pairingUrlInput.focus();
    return;
  }

  pairButton.disabled = true;
  setStatus(t('Pairing...'));

  try {
    if (isInsecureSiteUrl(pairingUrl)) {
      const proceed = window.confirm(
        t('This pairing target uses HTTP only. Requests are not protected by TLS, so an active network attacker could intercept pairing or publishing traffic. Continue anyway?')
      );
      if (!proceed) {
        setStatus(t('Pairing cancelled. Use an HTTPS WordPress URL when possible.'), { error: true });
        return;
      }
      setStatus(t('Warning: pairing over HTTP only. TLS certificate validation is unavailable.'), { error: true });
    }

    const result = await window.electronAPI.pluginTrigger('wordpress_publish', 'pair-site', {
      pairingUrl
    });
    if (result?.pending) {
      const oneTimeCode = String(result.oneTimeCode || '').trim();
      const pairingRequestId = String(result.pairingRequestId || '').trim();
      const siteBaseUrl = String(result.siteBaseUrl || pairingUrl).trim();
      if (!pairingRequestId) {
        throw new Error(t('Pairing request did not return an ID.'));
      }
      if (oneTimeCode) {
        setStatus(t('Pending approval in WordPress. One-time code: XX').replace('XX', oneTimeCode));
      } else {
        setStatus(t('Pending approval in WordPress settings.'));
      }

      const maxPolls = 40;
      const intervalMs = 3000;
      for (let i = 0; i < maxPolls; i += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
        const status = await window.electronAPI.pluginTrigger('wordpress_publish', 'pair-status', {
          siteBaseUrl,
          pairingRequestId
        });
        if (status?.paired) {
          renderPairings(status?.pairings || []);
          const siteName = decodeHtmlEntities(status?.pairing?.siteName || t('WordPress site'));
          setStatus(t('Paired with XX.').replace('XX', siteName));
          return;
        }
        if (status?.rejected) {
          throw new Error(status?.message || t('Pairing request rejected in WordPress.'));
        }
      }
      throw new Error(t('Timed out waiting for WordPress admin approval.'));
    }
    renderPairings(result?.pairings || []);
    const siteName = decodeHtmlEntities(result?.pairing?.siteName || t('WordPress site'));
    setStatus(t('Paired with XX.').replace('XX', siteName));
  } catch (err) {
    setStatus(err.message || t('Pairing failed.'), { error: true });
  } finally {
    pairButton.disabled = false;
  }
}

async function initPage() {
  const language = navigator.language.slice(0, 2);
  if (typeof window.loadTranslations === 'function') {
    await window.loadTranslations();
  }
  if (typeof window.translatePage === 'function') {
    window.translatePage(language);
  }
  pairingUrlInput.placeholder = t('https://example.org');
  setPublishTargetLabel();
  await refreshPairings();
}

document.addEventListener('click', () => closeAllMenus());

pairingHelpButton?.addEventListener('click', () => {
  window.electronAPI?.openHandoutView('readme', 'plugins-wordpress_publish-readme.md').catch((err) => {
    console.error(err);
    window.alert(`Failed to open help: ${err.message || err}`);
  });
});

pairButton.addEventListener('click', pairCurrentSite);
pairingUrlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    pairCurrentSite();
  }
});

if (window.translationsLoaded) {
  initPage();
} else {
  window.addEventListener('translations-loaded', () => {
    initPage().catch((err) => {
      console.warn('[wordpress_publish] failed to initialize i18n:', err);
      setPublishTargetLabel();
      refreshPairings();
    });
  }, { once: true });
}
