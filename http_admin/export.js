/*
 * Export window (export.html; opened with ?slug=<folder>&md=<file>).
 *
 * Loaded after /js/translate.js. Builds the format list (ZIP, PDF vector/raster, PPTX,
 * images, plus plugin formats from electronAPI.getPluginExportFormats, which add
 * `plugin:<plugin>:<id>` radios and option fields) and runs the chosen export through the
 * preload API: exportPresentation, exportPresentationPDF, exportPresentationPDFRaster,
 * exportPresentationPPTX, exportImages, pluginTrigger(plugin, `export_<id>`, {slug, options}).
 * Progress/status arrive through onExportProgress / onExportStatus subscriptions.
 */
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
  const pptxOptions = document.getElementById('pptx-options');
  const formatList = document.getElementById('format-list');
  const closeBtn = document.getElementById('close-btn');
  const progressEl = document.getElementById('export-progress');
  const progressBar = document.getElementById('export-progress-bar');
  let unsubscribeExportProgress = null;
  const exportBtn = document.getElementById('export-btn');
  const exportStatus = document.getElementById('export-status');
  const useRevealRemotePublicServer = document.getElementById('use-reveal-remote-public-server');
  const revealRemotePublicServerNote = document.getElementById('reveal-remote-public-server-note');
  const createStandalonePresentation = document.getElementById('create-standalone-presentation');
  const showSplashscreenCheckbox = document.getElementById('show-splashscreen');
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
    const standalone = !!createStandalonePresentation?.checked;
    if (!standalone) {
      useRevealRemotePublicServer.checked = false;
      useRevealRemotePublicServer.disabled = true;
      revealRemotePublicServerNote.textContent = t('Only used when Create Standalone Presentation is enabled.');
      return;
    }
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

  const updateStandaloneDependentUI = () => {
    const standalone = !!createStandalonePresentation?.checked;
    if (showSplashscreenCheckbox) showSplashscreenCheckbox.disabled = !standalone;
    updateRevealRemotePublicServerUI();
  };
  createStandalonePresentation?.addEventListener('change', updateStandaloneDependentUI);
  updateStandaloneDependentUI();

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
    imgOptions.hidden = !['images', 'pdf-raster', 'pptx'].includes(selected);
    pptxOptions.hidden = selected !== 'pptx';
    zipOptions.hidden = selected !== 'zip';
    pluginOptionsEl.hidden = !selected.startsWith('plugin:');
  }

  // Status line in the footer; type is info | success | warning | error.
  const setStatus = (message, type = 'info') => {
    exportStatus.textContent = message;
    exportStatus.dataset.type = type;
  };

  closeBtn.addEventListener('click', () => window.close());

  // Progress bar: determinate while slides are captured, indeterminate while the deck
  // loads and while the output file is built.
  const showProgress = (fraction = null) => {
    progressEl.hidden = false;
    const indeterminate = fraction === null;
    progressEl.classList.toggle('is-indeterminate', indeterminate);
    if (indeterminate) {
      progressBar.style.width = '';
      progressEl.removeAttribute('aria-valuenow');
    } else {
      const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
      progressBar.style.width = `${percent}%`;
      progressEl.setAttribute('aria-valuenow', String(percent));
    }
  };

  const hideProgress = () => {
    progressEl.hidden = true;
    progressEl.classList.remove('is-indeterminate');
    progressBar.style.width = '0%';
  };

  const handleExportProgress = (progress) => {
    if (!progress) return;
    if (progress.phase === 'loading') {
      setStatus(t('Opening presentation...'));
      showProgress(null);
    } else if (progress.phase === 'capturing' && progress.total > 0) {
      setStatus(t('Capturing slide {done} of {total}...')
        .replace('{done}', progress.done)
        .replace('{total}', progress.total));
      showProgress(progress.done / progress.total);
    } else if (progress.phase === 'building') {
      setStatus(t('Saving file...'));
      showProgress(null);
    }
  };

  const listenForProgress = () => {
    if (!unsubscribeExportProgress && window.electronAPI.onExportProgress) {
      unsubscribeExportProgress = window.electronAPI.onExportProgress(handleExportProgress);
    }
  };
  setStatus(t('Choose a format, then click Export.'));
  window.addEventListener('translations-loaded', () => {
    if (!exportBtn.disabled && !exportStatus.dataset.type?.match(/success|error/)) {
      setStatus(t('Choose a format, then click Export.'));
    }
  });

  function renderPluginOptions(fmt) {
    pluginOptionsFields.innerHTML = '';
    for (const opt of (fmt.options || [])) {
      const fieldId = `plugin-opt-${opt.key}`;
      const label = document.createElement('label');
      const labelText = `<span class="field-sublabel">${escapeHTML(opt.label || opt.key)}</span>`;
      if (opt.type === 'checkbox') {
        label.className = 'check-row';
        label.innerHTML = `<input type="checkbox" id="${escapeHTML(fieldId)}" ${opt.default ? 'checked' : ''} data-plugin-key="${escapeHTML(opt.key)}" data-plugin-type="checkbox" /> <span>${escapeHTML(opt.label || opt.key)}</span>`;
      } else if (opt.type === 'number') {
        const min = opt.min !== undefined ? ` min="${escapeHTML(String(opt.min))}"` : '';
        const max = opt.max !== undefined ? ` max="${escapeHTML(String(opt.max))}"` : '';
        label.className = 'field';
        label.innerHTML = `${labelText}<input class="input" type="number" id="${escapeHTML(fieldId)}" value="${escapeHTML(String(opt.default ?? ''))}"${min}${max} data-plugin-key="${escapeHTML(opt.key)}" data-plugin-type="number" />`;
      } else if (opt.type === 'select') {
        const choices = (opt.choices || []).map(c =>
          `<option value="${escapeHTML(c.value)}"${c.value === opt.default ? ' selected' : ''}>${escapeHTML(c.label)}</option>`
        ).join('');
        label.className = 'field';
        label.innerHTML = `${labelText}<select class="input" id="${escapeHTML(fieldId)}" data-plugin-key="${escapeHTML(opt.key)}" data-plugin-type="select">${choices}</select>`;
      } else {
        label.className = 'field';
        label.innerHTML = `${labelText}<input class="input" type="text" id="${escapeHTML(fieldId)}" value="${escapeHTML(String(opt.default ?? ''))}" data-plugin-key="${escapeHTML(opt.key)}" data-plugin-type="text" />`;
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
      for (const fmt of pluginFormats) {
        const value = `plugin:${fmt.pluginName}:${fmt.id}`;
        const label = document.createElement('label');
        label.className = 'choice';
        const desc = fmt.description ? `<span class="choice-desc">${escapeHTML(fmt.description)}</span>` : '';
        label.innerHTML = `<input type="radio" name="format" value="${escapeHTML(value)}" />`
          + `<span class="choice-text"><span class="choice-title">${escapeHTML(fmt.label)}</span>${desc}</span>`;
        formatList.appendChild(label);
      }
    })
    .catch((err) => {
      console.warn('Failed to load plugin export formats', err);
    });

  const setWorking = (message = t('Working, please wait...')) => {
    exportBtn.disabled = true;
    closeBtn.disabled = true;
    formatList.querySelectorAll('input').forEach((el) => { el.disabled = true; });
    setStatus(message);
  };

  // Re-enables the form; the status line keeps the last result (success or error).
  const resetWorking = () => {
    hideProgress();
    if (unsubscribeExportProgress) {
      unsubscribeExportProgress();
      unsubscribeExportProgress = null;
    }
    exportBtn.disabled = false;
    closeBtn.disabled = false;
    formatList.querySelectorAll('input').forEach((el) => { el.disabled = false; });
    if (unsubscribeExportStatus) {
      unsubscribeExportStatus();
      unsubscribeExportStatus = null;
    }
  };

  exportBtn.addEventListener('click', async () => {
    const selected = document.querySelector('input[name="format"]:checked').value;
    const includeMedia = document.getElementById('include-media').checked;
    const createStandalone = !!createStandalonePresentation?.checked;
    const showSplashscreen = createStandalone && document.getElementById('show-splashscreen').checked;
    const usePublicServer = createStandalone && !!useRevealRemotePublicServer?.checked && !useRevealRemotePublicServer?.disabled;
    let shouldReset = true;
    const readImageOptions = () => ({
      width: parseInt(document.getElementById('img-width').value),
      height: parseInt(document.getElementById('img-height').value),
      delay: parseFloat(document.getElementById('img-delay').value)
    });

    try {
      if (selected === 'zip') {
        // 🧳 ZIP EXPORT 
        setWorking(t('Working, please wait...'));
        if (!unsubscribeExportStatus) {
          unsubscribeExportStatus = window.electronAPI.onExportStatus((status) => {
            if (status === 'exporting') {
              setStatus(t('Working, please wait...'));
            }
          });
        }
        const result = await window.electronAPI.exportPresentation(slug, includeMedia, {
          createStandalone,
          showSplashscreen,
          useRevealRemotePublicServer: usePublicServer
        });
        if (result?.success) {
          const omittedCount = Array.isArray(result.omitted) ? result.omitted.length : 0;
          const exportedMsg = t('Exported to: {filePath}').replace('{filePath}', result.filePath);
          if (omittedCount > 0) {
            setStatus(`${exportedMsg} ${t('({count} prohibited files omitted)').replace('{count}', String(omittedCount))}`, 'warning');
          } else {
            setStatus(exportedMsg, 'success');
          }
        } else if (result?.canceled) {
          setStatus(t('Export canceled.'));
        } else {
          setStatus(t('Export failed: {error}').replace('{error}', formatErrorForAlert(result?.error)), 'error');
        }
      }

      else if (selected === 'pdf-vector') {
        setWorking(t('Working, please wait...'));
        await window.electronAPI.exportPresentationPDF(slug, mdFile);
        shouldReset = false;
        window.close();
      }

      else if (selected === 'pdf-raster') {
        setWorking(t('Capturing slides, please wait...'));
        listenForProgress();
        const { width, height, delay } = readImageOptions();
        const result = await window.electronAPI.exportPresentationPDFRaster(slug, mdFile, width, height, delay);
        if (result?.success && !result.canceled) {
          setStatus(t('Exported PDF to: {filePath}').replace('{filePath}', result.filePath), 'success');
        } else if (result?.canceled) {
          setStatus(t('Export canceled.'));
        } else {
          setStatus(t('PDF export failed: {error}').replace('{error}', formatErrorForAlert(result?.error)), 'error');
        }
      }

      else if (selected === 'pptx') {
        setWorking(t('Capturing slides, please wait...'));
        listenForProgress();
        const { width, height, delay } = readImageOptions();
        const includeNotes = document.getElementById('include-notes').checked;
        const result = await window.electronAPI.exportPresentationPPTX(slug, mdFile, width, height, delay, { includeNotes });
        if (result?.success) {
          setStatus(t('Exported PowerPoint to: {filePath}').replace('{filePath}', result.filePath), 'success');
        } else if (result?.canceled) {
          setStatus(t('Export canceled.'));
        } else {
          setStatus(t('PowerPoint export failed: {error}').replace('{error}', formatErrorForAlert(result?.error)), 'error');
        }
      }

      else if (selected.startsWith('plugin:')) {
        const [, pluginName, formatId] = selected.split(':');
        setWorking(t('Working, please wait...'));
        const options = collectPluginOptions();
        const result = await window.electronAPI.pluginTrigger(pluginName, `export_${formatId}`, { slug, options });
        if (result?.success) {
          setStatus(t('Exported to: {filePath}').replace('{filePath}', result.filePath || ''), 'success');
        } else if (result?.canceled) {
          setStatus(t('Export canceled.'));
        } else if (result) {
          setStatus(t('Export failed: {error}').replace('{error}', formatErrorForAlert(result.error)), 'error');
        }
      }

      else if (selected === 'images') {
        setWorking(t('Capturing slides, please wait...'));
        listenForProgress();
        const { width, height, delay } = readImageOptions();
        const result = await window.electronAPI.exportImages(slug, mdFile, width, height, delay, false);
        if (result?.success && !result.canceled) {
          setStatus(t('Exported images to: {filePath}').replace('{filePath}', result.filePath), 'success');
        } else if (result?.canceled) {
          setStatus(t('Export canceled.'));
        } else {
          setStatus(t('Image export failed: {error}').replace('{error}', formatErrorForAlert(result?.error)), 'error');
        }
      }

    } catch (err) {
      console.error(err);
      setStatus(t('Error: {message}').replace('{message}', formatErrorForAlert(err.message)), 'error');
    } finally {
      if (shouldReset) {
        resetWorking();
      }
    }
  });
});
