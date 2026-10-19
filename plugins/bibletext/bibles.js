// plugins/bibletext/bibles.js  (browser, loaded by bibles.html)
// The Bible Downloads page: one card per offer in bibleDownloader.js ("collection", "net"). The collection card lists
// the manifest's language groups as checkboxes (get-bible-groups); "Download Selected Bibles" sends the ticked ones.
// Calls pluginTrigger('bibletext', get-bible-downloads | get-bible-groups | install-bible-download |
// get-download-progress); the install call stays pending until the download finishes, so progress comes from polling
// get-download-progress. All text is set with textContent. UI strings are translated through window.tr()
// (locales/translations.json).
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
      groupsBox: card.querySelector('.groups'),
      label: card.querySelector('button').textContent
    };
  });

  const groups = { state: 'idle', list: [], error: '' }; // state: idle | loading | ready | failed
  let busy = false;
  let pollTimer = null;
  let netInstalled = false;

  const checkedGroups = () => groups.list.filter((g) => g.checked).map((g) => g.id);

  function setStatus(card, text, kind) {
    card.status.textContent = text;
    card.status.classList.toggle('ok', kind === 'ok');
    card.status.classList.toggle('error', kind === 'error');
  }

  function renderGroups() {
    const box = cards.collection.groupsBox;
    box.textContent = '';
    if (groups.state === 'loading') {
      box.textContent = t('Loading…');
    } else if (groups.state === 'failed') {
      const message = document.createElement('span');
      message.className = 'status error';
      message.textContent = `${t('Could not load the list of Bibles:')} ${groups.error} `;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'link';
      retry.textContent = t('Try Again');
      retry.addEventListener('click', () => loadGroups());
      box.append(message, retry);
    } else {
      groups.list.forEach((group) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!group.checked;
        input.disabled = busy;
        input.addEventListener('change', () => { group.checked = input.checked; updateButtons(); });
        const size = group.bytes ? `, ${Math.max(0.1, group.bytes / (1024 * 1024)).toFixed(1)} MB` : '';
        const detail = document.createElement('small');
        detail.textContent = ` (${group.count} ${t(group.count === 1 ? 'Bible' : 'Bibles')}${size})${group.installed ? ` ✓ ${t('Installed.')}` : ''}`;
        label.append(input, ` ${t(group.label)}`, detail);
        box.appendChild(label);
      });
    }
  }

  function updateButtons() {
    cards.collection.button.disabled = busy || groups.state !== 'ready' || !checkedGroups().length;
    cards.net.button.disabled = busy;
    cards.collection.groupsBox.querySelectorAll('input').forEach((input) => { input.disabled = busy; });
  }

  async function loadGroups() {
    groups.state = 'loading';
    renderGroups();
    updateButtons();
    let result;
    try {
      result = await call('get-bible-groups');
    } catch (err) {
      result = { success: false, error: err && err.message ? err.message : String(err) };
    }
    if (result && result.success) {
      const defaults = new Set(result.defaults || []);
      groups.list = result.groups.map((g) => ({ ...g, checked: defaults.has(g.id) && !g.installed }));
      groups.state = 'ready';
    } else {
      groups.state = 'failed';
      groups.error = (result && result.error) || '';
    }
    renderGroups();
    updateButtons();
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

  function renderIdle() {
    Object.values(cards).forEach((card) => { card.progress.hidden = true; });
    cards.net.button.textContent = netInstalled ? t('Download Again') : t(cards.net.label);
    cards.collection.button.textContent = t(cards.collection.label);
    if (netInstalled) setStatus(cards.net, t('Installed.'), 'ok');
    updateButtons();
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

  async function refreshStatus() {
    const res = await call('get-bible-downloads').catch(() => null);
    netInstalled = !!(res && res.status && res.status.net && res.status.net.installed);
  }

  async function download(id) {
    if (busy) return;
    busy = true;
    updateButtons();
    renderRunning(id, {});
    startPolling(id);
    let result;
    try {
      result = await call('install-bible-download', id === 'collection' ? { id, groups: checkedGroups() } : { id });
    } catch (err) {
      result = { success: false, error: err && err.message ? err.message : String(err) };
    }
    stopPolling();
    busy = false;
    await refreshStatus();
    renderIdle();
    const card = cards[id];
    if (result && result.success) {
      setStatus(card, t('Installed.'), 'ok');
      if (id === 'collection') await loadGroups(); // refresh the "installed" marks
    } else {
      card.button.textContent = t('Try Again');
      setStatus(card, `${t('Install failed:')} ${(result && result.error) || ''}`, 'error');
    }
  }

  Object.entries(cards).forEach(([id, card]) => {
    card.button.addEventListener('click', () => download(id));
  });

  await refreshStatus();
  renderIdle();
  loadGroups();

  const initial = await call('get-bible-downloads');
  if (initial && initial.progress && initial.progress.running) {
    // Opened while a download (started from the first-run setup or another window) is still going.
    busy = true;
    updateButtons();
    renderRunning(initial.progress.running, initial.progress);
    startPolling(initial.progress.running);
    const waitDone = setInterval(async () => {
      const p = await call('get-download-progress').catch(() => null);
      if (p && !p.running) {
        clearInterval(waitDone);
        stopPolling();
        busy = false;
        await refreshStatus();
        renderIdle();
        loadGroups();
      }
    }, 1000);
  }
})();
