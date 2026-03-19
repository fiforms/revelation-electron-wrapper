window.translationsources.push('/admin/locales/translations.json');

function t(key) {
  if (typeof window.tr === 'function') return window.tr(key);
  return key;
}

function formatErrorForAlert(errorValue) {
  const raw = String(errorValue || '').trim();
  if (!raw) return t('Unknown error');
  const maxLen = 220;
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen)}...`;
}

function normalizeMdQueryValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'presentation.md';
  if (raw === 'undefined' || raw === 'null') return 'presentation.md';
  return raw;
}

function escapeHTML(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', () => {
  const formatRadios = document.querySelectorAll('input[name="format"]');
  const imgOptions = document.getElementById('images-options');
  const zipOptions = document.getElementById('zip-options');
  const exportBtn = document.getElementById('export-btn');
  const exportStatus = document.getElementById('export-status');
  const useRevealRemotePublicServer = document.getElementById('use-reveal-remote-public-server');
  const revealRemotePublicServerNote = document.getElementById('reveal-remote-public-server-note');
  let unsubscribeExportStatus = null;

  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');
  const mdFile = normalizeMdQueryValue(urlParams.get('md'));
  let appConfig = null;

  const applyLocalizedTooltips = () => {
    document.querySelectorAll('[data-tooltip-key]').forEach((el) => {
      const key = String(el.getAttribute('data-tooltip-key') || '').trim();
      if (!key) return;
      el.title = t(key);
    });
  };

  applyLocalizedTooltips();
  window.addEventListener('translations-loaded', applyLocalizedTooltips);

  const updateRevealRemotePublicServerUI = () => {
    const remoteServer = String(appConfig?.revealRemotePublicServer || '').trim();
    if (!useRevealRemotePublicServer || !revealRemotePublicServerNote) return;
    if (remoteServer) {
      if (useRevealRemotePublicServer.dataset.initialized !== 'true') {
        useRevealRemotePublicServer.checked = true;
        useRevealRemotePublicServer.dataset.initialized = 'true';
      }
      useRevealRemotePublicServer.disabled = false;
      revealRemotePublicServerNote.innerHTML =
        `<code>${escapeHTML(remoteServer)}</code><br>${t('You can change this in Settings.')}`;
      return;
    }
    useRevealRemotePublicServer.checked = false;
    useRevealRemotePublicServer.disabled = true;
    useRevealRemotePublicServer.dataset.initialized = 'true';
    revealRemotePublicServerNote.textContent = t('No Reveal Remote Public Server is configured in Settings.');
  };
  window.addEventListener('translations-loaded', updateRevealRemotePublicServerUI);

  window.electronAPI.getAppConfig()
    .then((loadedConfig) => {
      appConfig = loadedConfig || {};
      updateRevealRemotePublicServerUI();
    })
    .catch((err) => {
      console.warn('Failed to load app config for export screen', err);
      updateRevealRemotePublicServerUI();
    });

  formatRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const showImageOptions = radio.value === 'images' || radio.value === 'pdf-raster';
      imgOptions.style.display = showImageOptions ? 'block' : 'none';
      zipOptions.style.display = radio.value === 'zip' ? 'block' : 'none';
    });
  });

  const setWorking = (message = t('Working, please wait...')) => {
    exportBtn.disabled = true;
    exportStatus.textContent = message;
  };

  const resetWorking = () => {
    exportBtn.textContent = t('Export');
    exportBtn.disabled = false;
    exportStatus.textContent = '';
    if (unsubscribeExportStatus) {
      unsubscribeExportStatus();
      unsubscribeExportStatus = null;
    }
  };

  exportBtn.addEventListener('click', async () => {
    const selected = document.querySelector('input[name="format"]:checked').value;
    const includeMedia = document.getElementById('include-media').checked;
    const showSplashscreen = document.getElementById('show-splashscreen').checked;
    const usePublicServer = !!useRevealRemotePublicServer?.checked && !useRevealRemotePublicServer?.disabled;
    let shouldReset = true;

    try {
      if (selected === 'zip') {
        // 🧳 ZIP EXPORT 
        setWorking(t('Working, please wait...'));
        if (!unsubscribeExportStatus) {
          unsubscribeExportStatus = window.electronAPI.onExportStatus((status) => {
            if (status === 'exporting') {
              exportStatus.textContent = t('Working, please wait...');
            }
          });
        }
        const result = await window.electronAPI.exportPresentation(slug, includeMedia, {
          showSplashscreen,
          useRevealRemotePublicServer: usePublicServer
        });
        if (result?.success) {
          const message = t('Exported ZIP to: {filePath}').replace('{filePath}', result.filePath);
          alert(message);
          shouldReset = false;
          window.close();
        } else if (!result?.canceled) {
          const message = t('Export failed: {error}').replace('{error}', result?.error || t('Unknown error'));
          alert(message);
        }
      }

      else if (selected === 'pdf' || selected === 'pdf-vector') {
        setWorking(t('Working, please wait...'));
        await window.electronAPI.exportPresentationPDF(slug, mdFile);

        /*

        // 🧾 PDF EXPORT — open external browser for Reveal.js print-pdf
        const appConfig = await window.electronAPI.getAppConfig();
        const url = `http://${appConfig.hostURL || 'localhost'}:${appConfig.viteServerPort}/presentations_${appConfig.key}/${slug}/index.html?print-pdf&p=${mdFile}`;
        await window.electronAPI.openExternalURL(url);
        alert('📄 Opening in browser for PDF export...');
        */
        shouldReset = false;
        window.close();
      }

      else if (selected === 'pdf-raster') {
        setWorking(t('Working, please wait...'));
        const width = parseInt(document.getElementById('img-width').value);
        const height = parseInt(document.getElementById('img-height').value);
        const delay = parseInt(document.getElementById('img-delay').value);
        const result = await window.electronAPI.exportPresentationPDFRaster(slug, mdFile, width, height, delay);
        if (result?.success && !result.canceled) {
          const message = t('Exported PDF to: {filePath}').replace('{filePath}', result.filePath);
          alert(message);
          shouldReset = false;
          window.close();
        } else if (!result?.canceled) {
          const message = t('PDF export failed: {error}').replace('{error}', formatErrorForAlert(result.error));
          alert(message);
        }
      }

      else if (selected === 'images') {
        setWorking(t('Working, please wait...'));
        const width = parseInt(document.getElementById('img-width').value);
        const height = parseInt(document.getElementById('img-height').value);
        const delay = parseInt(document.getElementById('img-delay').value);
        const result = await window.electronAPI.exportImages(slug, mdFile, width, height, delay, false);
        if (result?.success && !result.canceled) {
          const message = t('Exported images to: {filePath}').replace('{filePath}', result.filePath);
          alert(message);
          shouldReset = false;
          window.close();
        } else if (!result?.canceled) {
          const message = t('Image export failed: {error}').replace('{error}', result.error || t('Unknown error'));
          alert(message);
        }
      }

    } catch (err) {
      console.error(err);
      const message = t('Error: {message}').replace('{message}', formatErrorForAlert(err.message));
      alert(message);
    } finally {
      if (shouldReset) {
        resetWorking();
      }
    }
  });
});
