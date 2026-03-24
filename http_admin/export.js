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
  const imgOptions = document.getElementById('images-options');
  const zipOptions = document.getElementById('zip-options');
  const pluginOptionsEl = document.getElementById('plugin-options');
  const pluginOptionsFields = document.getElementById('plugin-options-fields');
  const exportBtn = document.getElementById('export-btn');
  const exportStatus = document.getElementById('export-status');
  const useRevealRemotePublicServer = document.getElementById('use-reveal-remote-public-server');
  const revealRemotePublicServerNote = document.getElementById('reveal-remote-public-server-note');
  let unsubscribeExportStatus = null;
  let pluginFormats = [];

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

  function updateOptionsVisibility(selected) {
    const showImageOptions = selected === 'images' || selected === 'pdf-raster';
    imgOptions.style.display = showImageOptions ? 'block' : 'none';
    zipOptions.style.display = selected === 'zip' ? 'block' : 'none';
    pluginOptionsEl.style.display = selected.startsWith('plugin:') ? 'block' : 'none';
  }

  function renderPluginOptions(fmt) {
    pluginOptionsFields.innerHTML = '';
    for (const opt of (fmt.options || [])) {
      const fieldId = `plugin-opt-${opt.key}`;
      const label = document.createElement('label');
      if (opt.type === 'checkbox') {
        label.innerHTML = `<input type="checkbox" id="${escapeHTML(fieldId)}" ${opt.default ? 'checked' : ''} data-plugin-key="${escapeHTML(opt.key)}" data-plugin-type="checkbox" /> <span>${escapeHTML(opt.label || opt.key)}</span>`;
      } else if (opt.type === 'number') {
        const min = opt.min !== undefined ? ` min="${opt.min}"` : '';
        const max = opt.max !== undefined ? ` max="${opt.max}"` : '';
        label.innerHTML = `<span>${escapeHTML(opt.label || opt.key)}:</span> <input type="number" id="${escapeHTML(fieldId)}" value="${escapeHTML(String(opt.default ?? ''))}"${min}${max} data-plugin-key="${escapeHTML(opt.key)}" data-plugin-type="number" />`;
      } else if (opt.type === 'select') {
        const choices = (opt.choices || []).map(c =>
          `<option value="${escapeHTML(c.value)}"${c.value === opt.default ? ' selected' : ''}>${escapeHTML(c.label)}</option>`
        ).join('');
        label.innerHTML = `<span>${escapeHTML(opt.label || opt.key)}:</span> <select id="${escapeHTML(fieldId)}" data-plugin-key="${escapeHTML(opt.key)}" data-plugin-type="select">${choices}</select>`;
      } else {
        label.innerHTML = `<span>${escapeHTML(opt.label || opt.key)}:</span> <input type="text" id="${escapeHTML(fieldId)}" value="${escapeHTML(String(opt.default ?? ''))}" data-plugin-key="${escapeHTML(opt.key)}" data-plugin-type="text" />`;
      }
      pluginOptionsFields.appendChild(label);
    }
  }

  function collectPluginOptions() {
    const result = {};
    pluginOptionsFields.querySelectorAll('[data-plugin-key]').forEach(el => {
      const key = el.dataset.pluginKey;
      const type = el.dataset.pluginType;
      if (type === 'checkbox') result[key] = el.checked;
      else if (type === 'number') result[key] = parseFloat(el.value);
      else result[key] = el.value;
    });
    return result;
  }

  // Use event delegation on the whole document to catch dynamically-added plugin radios
  document.addEventListener('change', (e) => {
    if (e.target.name !== 'format') return;
    const selected = e.target.value;
    updateOptionsVisibility(selected);
    if (selected.startsWith('plugin:')) {
      const [, pluginName, formatId] = selected.split(':');
      const fmt = pluginFormats.find(f => f.pluginName === pluginName && f.id === formatId);
      if (fmt) renderPluginOptions(fmt);
    }
  });

  // Load plugin export formats and inject radio buttons
  window.electronAPI.getPluginExportFormats()
    .then((formats) => {
      pluginFormats = formats || [];
      const formatFieldset = document.querySelector('fieldset');
      for (const fmt of pluginFormats) {
        const value = `plugin:${fmt.pluginName}:${fmt.id}`;
        const label = document.createElement('label');
        label.innerHTML = `<input type="radio" name="format" value="${escapeHTML(value)}" /> <span>${escapeHTML(fmt.label)}</span>`;
        if (fmt.description) {
          const small = document.createElement('small');
          small.textContent = fmt.description;
          label.appendChild(small);
        }
        formatFieldset.appendChild(label);
      }
    })
    .catch((err) => {
      console.warn('Failed to load plugin export formats', err);
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

      else if (selected.startsWith('plugin:')) {
        const [, pluginName, formatId] = selected.split(':');
        setWorking(t('Working, please wait...'));
        const options = collectPluginOptions();
        const result = await window.electronAPI.pluginTrigger(pluginName, `export_${formatId}`, { slug, options });
        if (result?.success) {
          const message = t('Exported to: {filePath}').replace('{filePath}', result.filePath || '');
          alert(message);
          shouldReset = false;
          window.close();
        } else if (result && !result.canceled) {
          const message = t('Export failed: {error}').replace('{error}', formatErrorForAlert(result.error));
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
