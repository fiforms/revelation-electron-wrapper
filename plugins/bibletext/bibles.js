// plugins/bibletext/bibles.js  (browser, loaded by bibles.html)
// The Bible Downloads page: one card per offer in bibleDownloader.js ("collection", "net"). Calls
// pluginTrigger('bibletext', get-bible-downloads | install-bible-download | get-download-progress); the install call
// stays pending until the download finishes, so progress comes from polling get-download-progress.
// All text is set with textContent. UI strings are translated through window.tr() (locales/translations.json).
(async () => {
  const api = window.electronAPI;
  const call = (name, data) => api.pluginTrigger('bibletext', name, data);

  window.translationsources ||= [];
  window.translationsources.push(new URL('./locales/translations.json', window.location.href).pathname);
  if (typeof window.loadTranslations === 'function') await window.loadTranslations();
  let language = 'en';
  try {
    const cfg = await api.getAppConfig();
    language = String(cfg?.language || 'en').split('-')[0].toLowerCase() || 'en';
  } catch (_err) {
    // keep English
  }
  if (typeof window.translatePage === 'function') window.translatePage(language);
  const t = (key) => (typeof window.tr === 'function' ? window.tr(key) : key);

  const cards = {};
  document.querySelectorAll('[data-offer]').forEach((card) => {
    cards[card.dataset.offer] = {
      button: card.querySelector('button'),
      status: card.querySelector('.status'),
      progress: card.querySelector('progress'),
      label: card.querySelector('button').textContent
    };
  });

  let busy = false;
  let pollTimer = null;

  function setStatus(card, text, kind) {
    card.status.textContent = text;
    card.status.classList.toggle('ok', kind === 'ok');
    card.status.classList.toggle('error', kind === 'error');
  }

  function renderRunning(id, progress) {
    const card = cards[id];
    if (!card) return;
    const { received, total, phase, label } = progress || {};
    card.progress.hidden = false;
    if (phase === 'converting') {
      setStatus(card, t('Installing…'));
      card.progress.removeAttribute('value');
    } else if (total) {
      card.progress.value = Math.floor((received / total) * 100);
      setStatus(card, `${t('Downloading…')} ${received}/${total}${label ? ` ${label}` : ''}`);
    } else {
      card.progress.removeAttribute('value');
      setStatus(card, t('Downloading…'));
    }
  }

  function lockButtons(running) {
    Object.values(cards).forEach((card) => { card.button.disabled = running; });
  }

  function renderIdle(status) {
    lockButtons(false);
    Object.entries(cards).forEach(([id, card]) => {
      card.progress.hidden = true;
      const installed = !!(status && status[id] && status[id].installed);
      card.button.textContent = installed ? t('Download Again') : t(card.label);
      if (installed) setStatus(card, t('Installed.'), 'ok');
    });
  }

  function startPolling(id) {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        renderRunning(id, await call('get-download-progress'));
      } catch (_err) {
        // the install call reports the real outcome
      }
    }, 500);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function download(id) {
    if (busy) return;
    busy = true;
    lockButtons(true);
    renderRunning(id, {});
    startPolling(id);
    let result;
    try {
      result = await call('install-bible-download', { id });
    } catch (err) {
      result = { success: false, error: err && err.message ? err.message : String(err) };
    }
    stopPolling();
    busy = false;
    const status = (await call('get-bible-downloads').catch(() => null))?.status;
    renderIdle(status);
    const card = cards[id];
    if (result && result.success) {
      setStatus(card, t('Installed.'), 'ok');
    } else {
      card.button.textContent = t('Try Again');
      setStatus(card, `${t('Install failed:')} ${(result && result.error) || ''}`, 'error');
    }
  }

  Object.entries(cards).forEach(([id, card]) => {
    card.button.addEventListener('click', () => download(id));
  });

  const initial = await call('get-bible-downloads');
  renderIdle(initial && initial.status);
  if (initial && initial.progress && initial.progress.running) {
    // Opened while a download (started from the first-run setup or another window) is still going.
    busy = true;
    lockButtons(true);
    renderRunning(initial.progress.running, initial.progress);
    startPolling(initial.progress.running);
    const waitDone = setInterval(async () => {
      const p = await call('get-download-progress').catch(() => null);
      if (p && !p.running) {
        clearInterval(waitDone);
        stopPolling();
        busy = false;
        renderIdle((await call('get-bible-downloads')).status);
      }
    }, 1000);
  }
})();
