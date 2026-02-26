(function () {
  const SETTINGS_ID = 'compactor-settings-overlay';
  let activeModalState = null;
  function t(key) {
    return typeof window.tr === 'function' ? window.tr(key) : key;
  }

  window.RevelationPlugins.compactor = {
    name: 'compactor',
    priority: 96,

    init(ctx) {
      this.context = ctx;
      if (ctx?.baseURL) {
        window.translationsources ||= [];
        window.translationsources.push(`${ctx.baseURL}/locales/translations.json`);
        if (typeof window.loadTranslations === 'function') {
          window.loadTranslations().catch((err) => {
            console.warn('[compactor] failed to load plugin translations:', err);
          });
        }
      }
    },

    getListMenuItems(pres) {
      return [
        {
          label: '🗜️ ' + t('Compact Presentation...'),
          action: async () => {
            if (!window.electronAPI?.pluginTrigger) {
              window.alert(t('Compactor is only available in the desktop app.'));
              return;
            }

            const options = await showCompactorSettingsDialog();
            if (!options) return;

            let startResult;
            try {
              startResult = await window.electronAPI.pluginTrigger('compactor', 'startCompaction', {
                slug: pres.slug,
                mdFile: pres.md,
                options
              });
            } catch (err) {
              window.alert(`${t('Compactor failed to start:')} ${err.message}`);
              return;
            }

            if (!startResult?.success || !startResult?.jobId) {
              window.alert(`${t('Compactor failed to start:')} ${startResult?.error || t('Unknown error')}`);
              return;
            }
          }
        }
      ];
    }
  };

  function showCompactorSettingsDialog() {
    if (activeModalState?.isOpen) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      let running = false;
      activeModalState = { isOpen: true };
      const overlay = document.createElement('div');
      overlay.id = SETTINGS_ID;
      overlay.style = [
        'position: fixed',
        'inset: 0',
        'background: rgba(0,0,0,0.52)',
        'z-index: 10020',
        'display: flex',
        'align-items: center',
        'justify-content: center',
        'padding: 20px'
      ].join(';');

      const panel = document.createElement('div');
      panel.style = [
        'width: min(460px, 100%)',
        'background: #1e1e1e',
        'color: #f5f5f5',
        'border: 1px solid #3f3f3f',
        'border-radius: 10px',
        'padding: 16px',
        'font-family: sans-serif',
        'box-shadow: 0 12px 28px rgba(0,0,0,0.5)'
      ].join(';');

      panel.innerHTML = `
        <div style="font-size:16px;font-weight:700;margin-bottom:12px;">${escapeHtml(t('Compactor Settings'))}</div>
        <label style="display:block;font-size:12px;margin:8px 0 4px;">${escapeHtml(t('Max width'))}</label>
        <input id="compactor-max-width" type="number" min="64" max="8192" value="1920" style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #555;background:#111;color:#fff;" />
        <label style="display:block;font-size:12px;margin:8px 0 4px;">${escapeHtml(t('Max height'))}</label>
        <input id="compactor-max-height" type="number" min="64" max="8192" value="1080" style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #555;background:#111;color:#fff;" />
        <label style="display:block;font-size:12px;margin:8px 0 4px;">${escapeHtml(t('Image quality (1-100)'))}</label>
        <input id="compactor-image-quality" type="number" min="1" max="100" value="85" style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #555;background:#111;color:#fff;" />
        <label style="display:block;font-size:12px;margin:8px 0 4px;">${escapeHtml(t('Convert PNG to'))}</label>
        <select id="compactor-convert-png-to" style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #555;background:#111;color:#fff;">
          <option value="none">${escapeHtml(t('No conversion'))}</option>
          <option value="webp">WebP</option>
          <option value="avif">AVIF</option>
        </select>
        <label style="display:block;font-size:12px;margin:8px 0 4px;">${escapeHtml(t('Convert JPG/JPEG to'))}</label>
        <select id="compactor-convert-jpg-to" style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #555;background:#111;color:#fff;">
          <option value="none">${escapeHtml(t('No conversion'))}</option>
          <option value="webp">WebP</option>
          <option value="avif">AVIF</option>
        </select>
        <label style="display:flex;gap:8px;align-items:center;margin:12px 0 4px;font-size:13px;">
          <input id="compactor-compact-video" type="checkbox" />
          <span>${escapeHtml(t('Compact videos'))}</span>
        </label>
        <label style="display:block;font-size:12px;margin:8px 0 4px;">${escapeHtml(t('Video quality (1-100)'))}</label>
        <input id="compactor-video-quality" type="number" min="1" max="100" value="85" disabled style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #555;background:#111;color:#fff;opacity:.6;" />
        <label style="display:flex;gap:8px;align-items:center;margin:12px 0 4px;font-size:13px;">
          <input id="compactor-remove-unreferenced" type="checkbox" />
          <span>${escapeHtml(t('Remove files not referenced in markdown'))}</span>
        </label>
        <div id="compactor-starting-msg" style="display:none;margin-top:14px;font-size:12px;color:#ddd;">${escapeHtml(t('Compacting beginning, watch for notification on completion.'))}</div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
          <button id="compactor-cancel" type="button" style="padding:8px 10px;border-radius:6px;border:1px solid #777;background:#2a2a2a;color:#fff;cursor:pointer;">${escapeHtml(t('Cancel'))}</button>
          <button id="compactor-start" type="button" style="padding:8px 10px;border-radius:6px;border:1px solid #4a6f3e;background:#3d7f2e;color:#fff;cursor:pointer;">${escapeHtml(t('Start compacting'))}</button>
        </div>
      `;

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      const maxWidthEl = panel.querySelector('#compactor-max-width');
      const maxHeightEl = panel.querySelector('#compactor-max-height');
      const imageQualityEl = panel.querySelector('#compactor-image-quality');
      const convertPngToEl = panel.querySelector('#compactor-convert-png-to');
      const convertJpgToEl = panel.querySelector('#compactor-convert-jpg-to');
      const compactVideoEl = panel.querySelector('#compactor-compact-video');
      const videoQualityEl = panel.querySelector('#compactor-video-quality');
      const removeUnreferencedEl = panel.querySelector('#compactor-remove-unreferenced');
      const startingMsgEl = panel.querySelector('#compactor-starting-msg');
      const cancelEl = panel.querySelector('#compactor-cancel');
      const startEl = panel.querySelector('#compactor-start');

      const close = (result) => {
        activeModalState = null;
        overlay.remove();
        resolve(result);
      };

      const validate = (value, min, max) => {
        const parsed = Number.parseInt(String(value || '').trim(), 10);
        if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
        return parsed;
      };

      const onToggleVideo = () => {
        const enabled = Boolean(compactVideoEl.checked);
        videoQualityEl.disabled = !enabled;
        videoQualityEl.style.opacity = enabled ? '1' : '.6';
      };
      compactVideoEl.addEventListener('change', onToggleVideo);
      onToggleVideo();

      overlay.addEventListener('click', (event) => {
        if (!running && event.target === overlay) close(null);
      });

      cancelEl.addEventListener('click', () => {
        if (!running) close(null);
      });
      startEl.addEventListener('click', () => {
        const maxWidth = validate(maxWidthEl.value, 64, 8192);
        const maxHeight = validate(maxHeightEl.value, 64, 8192);
        const imageQuality = validate(imageQualityEl.value, 1, 100);
        const compactVideo = Boolean(compactVideoEl.checked);
        const videoQuality = compactVideo ? validate(videoQualityEl.value, 1, 100) : 85;

        if (maxWidth == null || maxHeight == null || imageQuality == null || videoQuality == null) {
          window.alert(
            t('Please enter a whole number between XX and YY.')
              .replace('XX', '1')
              .replace('YY', '8192')
          );
          return;
        }

        running = true;
        maxWidthEl.disabled = true;
        maxHeightEl.disabled = true;
        imageQualityEl.disabled = true;
        convertPngToEl.disabled = true;
        convertJpgToEl.disabled = true;
        compactVideoEl.disabled = true;
        videoQualityEl.disabled = true;
        removeUnreferencedEl.disabled = true;
        startEl.style.display = 'none';
        cancelEl.disabled = true;
        startingMsgEl.style.display = 'block';

        setTimeout(() => {
          close({
            maxWidth,
            maxHeight,
            imageQuality,
            compactVideo,
            videoQuality,
            convertPngTo: String(convertPngToEl.value || 'none'),
            convertJpgTo: String(convertJpgToEl.value || 'none'),
            removeUnreferencedFiles: Boolean(removeUnreferencedEl.checked)
          });
        }, 1000);
      });
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
