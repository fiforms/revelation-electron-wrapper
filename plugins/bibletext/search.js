document.addEventListener('DOMContentLoaded', async () => {
  const language = navigator.language.slice(0, 2);
  window.translationsources ||= [];
  window.translationsources.push(new URL('./locales/translations.json', window.location.href).pathname);
  if (typeof window.loadTranslations === 'function') {
    await window.loadTranslations();
  }
  if (typeof window.translatePage === 'function') {
    window.translatePage(language);
  }

  const t = (key) => (typeof window.tr === 'function' ? window.tr(key) : key);

  const urlParams = new URLSearchParams(window.location.search);
  let slug = urlParams.get('slug');
  let mdFile = urlParams.get('md');
  const returnKey = urlParams.get('returnKey');
  const ref = document.getElementById('ref');
  const preview = document.getElementById('preview');
  const fetchBtn = document.getElementById('fetch');
  const insertBtn = document.getElementById('insert');
  const attributionSelect = document.getElementById('attribution');
  const customAttributionInput = document.getElementById('customAttribution');
  const langSelect = document.getElementById('lang');
  const sourceSelect = document.getElementById('source');
  const transSelect = document.getElementById('trans');
  const attributionPrefKey = 'bibletext.attributionPreference';
  const customAttributionPrefKey = 'bibletext.customAttributionByTranslation';
  ref.placeholder = t('Enter reference');
  preview.placeholder = t('Preview will appear here...');
  customAttributionInput.placeholder = t('Type custom attribution for this translation');
  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const normalizeLanguageCode = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (/^[a-z]{2}(?:-[a-z0-9]+)?$/.test(raw)) return raw.slice(0, 2);
    if (/^[a-z]{3}$/.test(raw)) {
      const iso3ToIso2 = {
        ara: 'ar', ces: 'cs', chi: 'zh', cze: 'cs', deu: 'de', dut: 'nl', ell: 'el',
        eng: 'en', fin: 'fi', fra: 'fr', fre: 'fr', ger: 'de', gre: 'el', heb: 'he',
        hin: 'hi', hun: 'hu', ita: 'it', jpn: 'ja', kor: 'ko', lat: 'la', nld: 'nl',
        nor: 'no', pol: 'pl', por: 'pt', ron: 'ro', rum: 'ro', rus: 'ru', spa: 'es',
        swe: 'sv', tur: 'tr', ukr: 'uk', zho: 'zh'
      };
      return iso3ToIso2[raw] || raw;
    }
    return 'und';
  };
  const normalizeLanguageLabel = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return t('Unknown language');
    const code = normalizeLanguageCode(raw);
    const codeToName = {
      ar: 'Arabic', cs: 'Czech', de: 'German', el: 'Greek', en: 'English', es: 'Spanish',
      fi: 'Finnish', fr: 'French', he: 'Hebrew', hi: 'Hindi', hu: 'Hungarian', it: 'Italian',
      ja: 'Japanese', ko: 'Korean', la: 'Latin', nl: 'Dutch', no: 'Norwegian', pl: 'Polish',
      pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', sv: 'Swedish', tr: 'Turkish',
      uk: 'Ukrainian', zh: 'Chinese'
    };
    return codeToName[code] || raw;
  };
  const browserLanguage = normalizeLanguageCode(navigator.language);
  const normalizeSource = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'local' || raw === 'online') return raw;
    return 'online';
  };
  let allTranslations = [];
  let customAttributionByTranslation = {};
  let lastFetchedSignature = null;
  let isFetching = false;
  let isInserting = false;
  const buildFetchSignature = () => JSON.stringify({
    ref: ref.value.trim(),
    translation: transSelect.value,
    attribution: attributionSelect.value,
    customAttribution: customAttributionInput.value.trim()
  });
  const getCurrentTranslationKey = () => String(transSelect.value || '').trim().toUpperCase();
  const persistCustomAttributionMap = () => {
    try {
      localStorage.setItem(customAttributionPrefKey, JSON.stringify(customAttributionByTranslation));
    } catch (_err) {
      // Ignore storage access issues.
    }
  };
  const loadCustomAttributionMap = () => {
    try {
      const raw = localStorage.getItem(customAttributionPrefKey);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        customAttributionByTranslation = parsed;
      } else {
        customAttributionByTranslation = {};
      }
    } catch (_err) {
      customAttributionByTranslation = {};
    }
  };
  const restoreCustomAttributionForCurrentTranslation = () => {
    const key = getCurrentTranslationKey();
    if (!key) {
      customAttributionInput.value = '';
      customAttributionInput.disabled = true;
      return;
    }
    customAttributionInput.disabled = false;
    const saved = customAttributionByTranslation[key];
    customAttributionInput.value = typeof saved === 'string' ? saved : '';
  };

  const renderTranslationOptions = (selectedLanguageCode = 'all', selectedSource = 'all') => {
    const filtered = allTranslations.filter(item => {
      const languageMatches = selectedLanguageCode === 'all' || item.languageCode === selectedLanguageCode;
      const sourceMatches = selectedSource === 'all' || item.source === selectedSource;
      return languageMatches && sourceMatches;
    });

    if (!filtered.length) {
      transSelect.innerHTML = `<option value="">${escapeHtml(t('No translations available for this language'))}</option>`;
      transSelect.disabled = true;
      restoreCustomAttributionForCurrentTranslation();
      return;
    }

    transSelect.disabled = false;
    transSelect.innerHTML = filtered
      .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
      .join('');
    transSelect.selectedIndex = 0;
    restoreCustomAttributionForCurrentTranslation();
  };

  const renderLanguageOptions = () => {
    const languageMap = new Map();
    for (const item of allTranslations) {
      if (!languageMap.has(item.languageCode)) {
        languageMap.set(item.languageCode, item.language);
      }
    }

    const sortedLanguages = Array.from(languageMap.entries())
      .sort((a, b) => a[1].localeCompare(b[1]));

    langSelect.innerHTML = [
      `<option value="all">${escapeHtml(t('All languages'))}</option>`,
      ...sortedLanguages.map(([code, label]) => (
        `<option value="${escapeHtml(code)}">${escapeHtml(label)}</option>`
      ))
    ].join('');

    if (languageMap.has(browserLanguage)) {
      langSelect.value = browserLanguage;
    } else {
      langSelect.value = 'all';
    }
    renderTranslationOptions(langSelect.value, sourceSelect.value);
  };

  const renderSourceOptions = () => {
    sourceSelect.innerHTML = [
      `<option value="all">${escapeHtml(t('All sources'))}</option>`,
      `<option value="local">${escapeHtml(t('Local'))}</option>`,
      `<option value="online">${escapeHtml(t('Online'))}</option>`
    ].join('');
    sourceSelect.value = 'all';
  };
  const renderAttributionOptions = () => {
    attributionSelect.innerHTML = [
      `<option value="on">${escapeHtml(t('Add Attribution'))}</option>`,
      `<option value="off">${escapeHtml(t('No Attribution'))}</option>`
    ].join('');
    let saved = 'on';
    try {
      const stored = localStorage.getItem(attributionPrefKey);
      if (stored === 'on' || stored === 'off') {
        saved = stored;
      }
    } catch (_err) {
      // Ignore storage access issues and fall back to default.
    }
    attributionSelect.value = saved;
  };

  // If not provided via URL, try to get from Electron (saved selection)
  if (!slug || !mdFile) {
    try {
      const current = await window.electronAPI.getCurrentPresentation();
      if (current?.slug && current?.mdFile) {
        slug = current.slug;
        mdFile = current.mdFile;
      }
    } catch (err) {
      console.warn('⚠️ Could not fetch current presentation:', err);
    }
  }

  // Enable or disable Insert button accordingly
  if (!slug || !mdFile) {
    if (returnKey) {
      insertBtn.disabled = false;
    } else {
      insertBtn.disabled = 'disabled';
      insertBtn.innerHTML = t('Cannot Insert (No Presentation)');
    }
  } else {
    insertBtn.disabled = false;
  }

  // 🔹 Fetch translation list
  const res = await window.electronAPI.pluginTrigger('bibletext', 'get-translations');
  if (res.success && Array.isArray(res.translations)) {
    allTranslations = res.translations.map(item => ({
      id: String(item?.id || ''),
      name: String(item?.name || ''),
      languageCode: normalizeLanguageCode(item?.languageCode),
      language: normalizeLanguageLabel(item?.language),
      source: normalizeSource(item?.source)
    })).filter(item => item.id && item.name);
  } else {
    allTranslations = [{
      id: 'KJV',
      name: t('King James Version (English)'),
      languageCode: 'en',
      language: 'English',
      source: 'online'
    }];
  }
  renderAttributionOptions();
  loadCustomAttributionMap();
  attributionSelect.onchange = () => {
    try {
      localStorage.setItem(attributionPrefKey, attributionSelect.value);
    } catch (_err) {
      // Ignore storage access issues.
    }
    lastFetchedSignature = null;
  };
  customAttributionInput.oninput = () => {
    const key = getCurrentTranslationKey();
    if (!key) return;
    const value = customAttributionInput.value;
    if (value.trim()) {
      customAttributionByTranslation[key] = value;
    } else {
      delete customAttributionByTranslation[key];
    }
    persistCustomAttributionMap();
    lastFetchedSignature = null;
  };
  renderSourceOptions();
  renderLanguageOptions();
  const rerenderFilteredTranslations = () => {
    renderTranslationOptions(langSelect.value, sourceSelect.value);
    lastFetchedSignature = null;
  };
  langSelect.onchange = rerenderFilteredTranslations;
  sourceSelect.onchange = rerenderFilteredTranslations;
  transSelect.onchange = () => {
    restoreCustomAttributionForCurrentTranslation();
    lastFetchedSignature = null;
  };

  // Focus reference input when the dialog opens for fast keyboard flow.
  setTimeout(() => {
    ref.focus();
  }, 0);

  const runFetch = async () => {
    if (isFetching) return false;
    if (!transSelect.value) {
      preview.value = `❌ ${t('No translations available')}`;
      lastFetchedSignature = null;
      return false;
    }
    isFetching = true;
    preview.value = t('Loading...');
    const signature = buildFetchSignature();
    try {
      const result = await window.electronAPI.pluginTrigger('bibletext', 'fetch-passage', {
      osis: ref.value,
      translation: transSelect.value,
      includeAttribution: attributionSelect.value !== 'off',
      customAttribution: customAttributionInput.value.trim()
    });
      if (result.success) {
        preview.value = result.markdown;
        lastFetchedSignature = signature;
        return true;
      }
      preview.value = `❌ ${t('Error:')} ${result.error}`;
      lastFetchedSignature = null;
      return false;
    } catch (err) {
      preview.value = `❌ ${t('Error:')} ${err?.message || String(err)}`;
      lastFetchedSignature = null;
      return false;
    } finally {
      isFetching = false;
    }
  };
  fetchBtn.onclick = runFetch;

  const runInsert = async () => {
    if (isInserting) return false;
    if (!preview.value.trim()) {
      alert(t('Fetch text first.'));
      return false;
    }
    isInserting = true;
    try {
      if (returnKey) {
        localStorage.setItem(returnKey, JSON.stringify({ markdown: preview.value }));
        window.close();
        return true;
      }
      await window.electronAPI.pluginTrigger('bibletext', 'insert-passage', {
        slug,
        mdFile,
        markdown: preview.value
      });
      alert(`✅ ${t('Passage inserted.')}`);
      window.close();
      return true;
    } finally {
      isInserting = false;
    }
  };
  insertBtn.onclick = runInsert;

  ref.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const currentSignature = buildFetchSignature();
    if (lastFetchedSignature && lastFetchedSignature === currentSignature && preview.value.trim()) {
      await runInsert();
      return;
    }
    await runFetch();
  });
});
