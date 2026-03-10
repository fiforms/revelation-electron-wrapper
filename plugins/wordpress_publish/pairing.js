const pairingUrlInput = document.getElementById('pairingUrlInput');
const pairButton = document.getElementById('pairButton');
const statusEl = document.getElementById('status');
const pairedList = document.getElementById('pairedList');
const emptyState = document.getElementById('emptyState');
const publishTargetEl = document.getElementById('publishTarget');

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
    publishTargetEl.textContent = 'No presentation selected. Open this window from a presentation card to enable publishing.';
    return;
  }
  const title = decodeHtmlEntities(currentPresentation.title || currentPresentation.slug);
  publishTargetEl.textContent = `Selected: ${title} (${currentPresentation.slug}/${currentPresentation.mdFile})`;
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
    setStatus('No presentation selected to publish.', { error: true });
    return;
  }

  if (isInsecureSiteUrl(item.siteBaseUrl)) {
    const proceed = window.confirm(
      'This WordPress site uses HTTP only. Publish tokens and presentation content can be intercepted or replayed on the network. Continue anyway?'
    );
    if (!proceed) {
      setStatus('Publish cancelled. HTTPS is recommended.', { error: true });
      return;
    }
  }

  publishBtn.disabled = true;
  setStatus(`Publishing ${currentPresentation.slug} to ${decodeHtmlEntities(item.siteName || item.siteBaseUrl)}...`);

  try {
    const result = await window.electronAPI.pluginTrigger('wordpress_publish', 'publish-presentation', {
      siteBaseUrl: item.siteBaseUrl,
      slug: currentPresentation.slug,
      mdFile: currentPresentation.mdFile
    });
    if (!result || result.success !== true) {
      throw new Error(result?.error || 'Publish failed in desktop plugin.');
    }

    const siteName = decodeHtmlEntities(result?.siteName || item.siteName || item.siteBaseUrl || 'WordPress site');
    const remoteSlug = String(result?.remoteSlug || currentPresentation.slug);
    const uploadedCount = Number(result?.uploadedCount || 0);
    const totalFiles = Number(result?.totalFiles || 0);
    const linkSuffix = result?.presentationUrl ? ` URL: ${result.presentationUrl}` : '';
    setStatus(`Published to ${siteName} as ${remoteSlug}. Uploaded ${uploadedCount}/${totalFiles} changed files.${linkSuffix}`);
  } catch (err) {
    setStatus(err.message || 'Publish failed.', { error: true });
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
    setStatus('Site unpaired.');
  } catch (err) {
    setStatus(err.message || 'Failed to unpair site.', { error: true });
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
    title.textContent = decodeHtmlEntities(item.siteName || item.siteBaseUrl || 'WordPress Site');
    const subtitle = document.createElement('small');
    const transportLabel = isInsecureSiteUrl(item.siteBaseUrl) ? 'HTTP only - insecure' : 'HTTPS';
    subtitle.textContent = `${item.siteBaseUrl || ''} (${item.authMode || 'unknown'}, ${transportLabel})`;
    const meta = document.createElement('small');
    meta.textContent = `Paired: ${formatDate(item.pairedAt)}`;
    left.appendChild(title);
    left.appendChild(subtitle);
    left.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'paired-actions';

    const publishBtn = document.createElement('button');
    publishBtn.type = 'button';
    publishBtn.className = 'publish-btn';
    publishBtn.textContent = 'Publish';
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
    unpairBtn.textContent = 'Unpair';
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
    setStatus(err.message || 'Failed to load pairings.', { error: true });
  }
}

async function pairCurrentSite() {
  const pairingUrl = pairingUrlInput.value.trim();

  if (!pairingUrl) {
    setStatus('Pairing URL is required.', { error: true });
    pairingUrlInput.focus();
    return;
  }

  pairButton.disabled = true;
  setStatus('Pairing...');

  try {
    if (isInsecureSiteUrl(pairingUrl)) {
      const proceed = window.confirm(
        'This pairing target uses HTTP only. Requests are not protected by TLS, so an active network attacker could intercept pairing or publishing traffic. Continue anyway?'
      );
      if (!proceed) {
        setStatus('Pairing cancelled. Use an HTTPS WordPress URL when possible.', { error: true });
        return;
      }
      setStatus('Warning: pairing over HTTP only. TLS certificate validation is unavailable.', { error: true });
    }

    const result = await window.electronAPI.pluginTrigger('wordpress_publish', 'pair-site', {
      pairingUrl
    });
    if (result?.pending) {
      const oneTimeCode = String(result.oneTimeCode || '').trim();
      const pairingRequestId = String(result.pairingRequestId || '').trim();
      const siteBaseUrl = String(result.siteBaseUrl || pairingUrl).trim();
      if (!pairingRequestId) {
        throw new Error('Pairing request did not return an ID.');
      }
      if (oneTimeCode) {
        setStatus(`Pending approval in WordPress. One-time code: ${oneTimeCode}`);
      } else {
        setStatus('Pending approval in WordPress settings.');
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
          const siteName = decodeHtmlEntities(status?.pairing?.siteName || 'WordPress site');
          setStatus(`Paired with ${siteName}.`);
          return;
        }
        if (status?.rejected) {
          throw new Error(status?.message || 'Pairing request rejected in WordPress.');
        }
      }
      throw new Error('Timed out waiting for WordPress admin approval.');
    }
    renderPairings(result?.pairings || []);
    const siteName = decodeHtmlEntities(result?.pairing?.siteName || 'WordPress site');
    setStatus(`Paired with ${siteName}.`);
  } catch (err) {
    setStatus(err.message || 'Pairing failed.', { error: true });
  } finally {
    pairButton.disabled = false;
  }
}

document.addEventListener('click', () => closeAllMenus());

pairButton.addEventListener('click', pairCurrentSite);
pairingUrlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    pairCurrentSite();
  }
});

setPublishTargetLabel();
refreshPairings();
