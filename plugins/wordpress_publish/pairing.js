window.translationsources ||= [];
window.translationsources.push(new URL('./locales/translations.json', window.location.href).pathname);

const pairingUrlInput = document.getElementById('pairingUrlInput');
const pairButton = document.getElementById('pairButton');
const statusEl = document.getElementById('status');
const pairedList = document.getElementById('pairedList');
const emptyState = document.getElementById('emptyState');
const publishTargetEl = document.getElementById('publishTarget');

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
