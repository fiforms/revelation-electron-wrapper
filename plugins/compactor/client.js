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

            const modal = await showCompactorSettingsDialog();
            if (!modal) return;

            let startResult;
            try {
              startResult = await window.electronAPI.pluginTrigger('compactor', 'startCompaction', {
                slug: pres.slug,
                mdFile: pres.md,
                options: modal.options
              });
            } catch (err) {
              modal.fail(`${t('Compactor failed to start:')} ${err.message}`);
              return;
            }

            if (!startResult?.success || !startResult?.jobId) {
              modal.fail(`${t('Compactor failed to start:')} ${startResult?.error || t('Unknown error')}`);
              return;
            }

            await monitorCompactionJob(
              startResult.jobId,
              startResult.targetSlug || `${pres.slug}_compacted`,
              modal
            );
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
        <label style="display:flex;gap:8px;align-items:center;margin:12px 0 4px;font-size:13px;">
          <input id="compactor-compact-video" type="checkbox" />
          <span>${escapeHtml(t('Compact videos'))}</span>
        </label>
        <label style="display:block;font-size:12px;margin:8px 0 4px;">${escapeHtml(t('Video quality (1-100)'))}</label>
        <input id="compactor-video-quality" type="number" min="1" max="100" value="85" disabled style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #555;background:#111;color:#fff;opacity:.6;" />
        <div id="compactor-progress-wrap" style="display:none;margin-top:14px;">
          <div id="compactor-progress-status" style="font-size:12px;margin-bottom:6px;color:#ddd;">${escapeHtml(t('Starting compaction...'))}</div>
          <progress id="compactor-progress-bar" value="0" max="100" style="width:100%;height:14px;"></progress>
          <div id="compactor-progress-count" style="font-size:12px;margin-top:6px;color:#bbb;">0 / 0</div>
        </div>
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
      const compactVideoEl = panel.querySelector('#compactor-compact-video');
      const videoQualityEl = panel.querySelector('#compactor-video-quality');
      const progressWrapEl = panel.querySelector('#compactor-progress-wrap');
      const progressStatusEl = panel.querySelector('#compactor-progress-status');
      const progressBarEl = panel.querySelector('#compactor-progress-bar');
      const progressCountEl = panel.querySelector('#compactor-progress-count');
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
        compactVideoEl.disabled = true;
        videoQualityEl.disabled = true;
        startEl.style.display = 'none';
        cancelEl.disabled = true;
        progressWrapEl.style.display = 'block';
        progressStatusEl.textContent = t('Starting compaction...');
        progressBarEl.value = 0;
        progressCountEl.textContent = '0 / 0';

        resolve({
          options: { maxWidth, maxHeight, imageQuality, compactVideo, videoQuality },
          setStatus(text) {
            progressStatusEl.textContent = String(text || '');
          },
          setProgress(processed, total) {
            const p = Number.isFinite(processed) ? Math.max(0, processed) : 0;
            const tmax = Number.isFinite(total) ? Math.max(0, total) : 0;
            const percent = tmax > 0 ? Math.round((p / tmax) * 100) : 0;
            progressBarEl.value = Math.max(0, Math.min(100, percent));
            progressCountEl.textContent = `${p} / ${tmax}`;
          },
          fail(message) {
            progressStatusEl.textContent = String(message || t('Unknown error'));
            progressBarEl.value = 0;
            cancelEl.disabled = false;
            cancelEl.textContent = t('Close');
            cancelEl.onclick = () => close(null);
          },
          done(summary) {
            const processed = Number(summary?.processedAssets || 0);
            const total = Number(summary?.totalAssets || 0);
            const failures = Number(summary?.failureCount || 0);
            this.setProgress(processed, total);
            const failureSuffix = failures > 0
              ? ` ${t('Failures: XX').replace('XX', String(failures))}`
              : '';
            progressStatusEl.textContent =
              `${t('Compactor complete.')} ${t('Output folder: XX').replace('XX', String(summary?.targetSlug || ''))}.${failureSuffix}`;
            cancelEl.disabled = false;
            cancelEl.textContent = t('Close');
            cancelEl.onclick = () => close(null);
          }
        });
      });
    });
  }

  async function monitorCompactionJob(jobId, targetSlug, modal) {
    modal.setStatus(t('Copying presentation folder...'));
    modal.setProgress(0, 0);
    while (true) {
      await delay(450);

      let status;
      try {
        status = await window.electronAPI.pluginTrigger('compactor', 'getCompactionStatus', { jobId });
      } catch (err) {
        modal.fail(`${t('Compactor status error:')} ${err.message}`);
        return;
      }

      if (!status?.success) {
        modal.fail(`${t('Compactor status error:')} ${status?.error || t('Unknown error')}`);
        return;
      }

      if (status.status === 'copying' || status.status === 'queued') {
        modal.setStatus(t('Copying presentation folder...'));
        modal.setProgress(0, Number(status.totalAssets || 0));
        continue;
      }

      if (status.status === 'running') {
        modal.setStatus(t('Compacting XX of YY assets...')
          .replace('XX', String(status.processedAssets))
          .replace('YY', String(status.totalAssets)));
        modal.setProgress(Number(status.processedAssets || 0), Number(status.totalAssets || 0));
        continue;
      }

      if (status.status === 'failed') {
        modal.fail(`${t('Compactor failed:')} ${status.message || t('Unknown error')}`);
        return;
      }

      modal.done({
        targetSlug,
        processedAssets: Number(status.processedAssets || 0),
        totalAssets: Number(status.totalAssets || 0),
        failureCount: Array.isArray(status.failures) ? status.failures.length : 0
      });
      return;
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
