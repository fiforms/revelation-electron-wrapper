const urlParams = new URLSearchParams(window.location.search);
const params = JSON.parse(urlParams.get('params') || '{}');
const slug = params.slug;
const mdFile = params.mdFile;
const returnKey = params.returnKey;

const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const statusBox = document.getElementById('status');
const resultsPanel = document.getElementById('results-panel');
const resultsList = document.getElementById('results-list');
const detailsPanel = document.getElementById('details-panel');
const selectedTitle = document.getElementById('selected-title');
const selectedSubtitle = document.getElementById('selected-subtitle');
const licenseValue = document.getElementById('license-value');
const sourceValue = document.getElementById('source-value');
const wordsValue = document.getElementById('words-value');
const ccliSongValue = document.getElementById('ccli-song-value');
const licenseMessage = document.getElementById('license-message');
const fetchLyricsButton = document.getElementById('fetch-lyrics-button');
const openSongSelectButton = document.getElementById('open-songselect-button');
const lyricsBox = document.getElementById('lyrics-box');
const insertButton = document.getElementById('insert-button');

let hymnIndex = [];
let currentHit = null;
let lastResolvedQuery = '';
let currentSourceUrl = '';
let hasLyricsLoaded = false;
let isFetchingLyrics = false;
let isInserting = false;
let ccliConfigured = false;

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeNumber(value) {
  const digits = String(value || '').trim();
  if (!/^\d+$/.test(digits)) return '';
  return String(Number.parseInt(digits, 10));
}

function getSongSelectUrl(ccliSongNumber) {
  const normalized = normalizeNumber(ccliSongNumber);
  if (!normalized) return '';
  return `https://songselect.ccli.com/songs/${normalized}`;
}

function formatLicense(value) {
  const license = normalizeText(value);
  if (license === 'public') return 'Public';
  if (license === 'ccli') return 'CCLI';
  if (license === 'other') return 'Other';
  return value ? String(value) : 'Unknown';
}

function setStatus(message, tone = '') {
  statusBox.textContent = message || '';
  statusBox.style.color = tone === 'error'
    ? 'var(--danger)'
    : tone === 'success'
      ? 'var(--success)'
      : 'var(--muted)';
}

function setLyricsText(text) {
  lyricsBox.value = String(text || '')
    .replace(/\r\n/g, '\n')
    .trim();
  hasLyricsLoaded = Boolean(lyricsBox.value.trim());
}

function clearSelectionState() {
  currentHit = null;
  currentSourceUrl = '';
  hasLyricsLoaded = false;
  detailsPanel.hidden = true;
  resultsPanel.hidden = true;
  resultsList.innerHTML = '';
  setLyricsText('');
  licenseMessage.hidden = true;
  fetchLyricsButton.hidden = true;
  openSongSelectButton.hidden = true;
}

function renderResults(results) {
  resultsList.innerHTML = '';
  resultsPanel.hidden = results.length === 0;

  for (const hit of results) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result-row';
    if (currentHit && String(currentHit.hymn_no) === String(hit.hymn_no)) {
      button.classList.add('selected');
    }

    const number = document.createElement('span');
    number.className = 'result-number';
    number.textContent = `#${hit.hymn_no}`;

    const title = document.createElement('span');
    title.textContent = hit.hymn_title || `Hymn ${hit.hymn_no}`;

    button.append(number, title);
    button.addEventListener('click', () => displayHit(hit, { updateResults: true }));
    item.appendChild(button);
    resultsList.appendChild(item);
  }
}

function getSourceLabel(hit) {
  if (hit?.license === 'public') {
    return 'Mirror';
  }
  return 'AdventistHymns.com';
}

function updateLicenseMessage(hit) {
  const license = normalizeText(hit?.license);
  if (license === 'ccli' && !ccliConfigured) {
    licenseMessage.textContent = 'The copyrighted lyrics of this hymn can be displayed with a CCLI license, but you must configure your license info in settings.';
    licenseMessage.className = 'message warning';
    licenseMessage.hidden = false;
    return;
  }

  if (license === 'other') {
    licenseMessage.textContent = 'The lyrics of this hymn are protected by copyright law, but the licensing terms are unknown. Please verify that you have permission to use these lyrics before proceeding.';
    licenseMessage.className = 'message warning';
    licenseMessage.hidden = false;
    return;
  }

  if (license !== 'public') {
    const messageParts = ['License information should be reviewed before use.'];
    if (hit?.copyright) {
      messageParts.push(`Copyright: ${hit.copyright}`);
    }
    licenseMessage.textContent = messageParts.join(' ');
    licenseMessage.className = 'message warning';
    licenseMessage.hidden = false;
    return;
  }

  licenseMessage.hidden = true;
}

async function fetchPublicLyrics(hit) {
  const response = await window.electronAPI.pluginTrigger('adventisthymns', 'fetchPublicLyrics', {
    number: hit.hymn_no
  });
  if (!response?.lyrics) {
    throw new Error('Public lyrics could not be downloaded.');
  }
  currentSourceUrl = response?.sourceUrl || '';
  setLyricsText(response?.lyrics || '');
}

async function fetchProtectedLyrics(hit) {
  const result = await window.electronAPI.pluginTrigger('adventisthymns', 'fetchHymnPreview', {
    number: hit.hymn_no
  });
  if (!result?.bodyMarkdown) {
    throw new Error('Lyrics could not be fetched from AdventistHymns.');
  }
  currentSourceUrl = result?.sourceUrl || '';
  setLyricsText(result?.bodyMarkdown || '');
}

async function loadLyricsForHit(hit, options = {}) {
  if (!hit || isFetchingLyrics) return;
  const isPublic = normalizeText(hit.license) === 'public';
  const shouldAutoFetch = options.autoFetch !== false;

  fetchLyricsButton.hidden = isPublic;
  if (!shouldAutoFetch) return;

  isFetchingLyrics = true;
  setStatus(`Loading hymn ${hit.hymn_no}...`);
  try {
    if (isPublic) {
      await fetchPublicLyrics(hit);
      setStatus(`Loaded public lyrics for hymn ${hit.hymn_no}.`, 'success');
    } else {
      await fetchProtectedLyrics(hit);
      setStatus(`Fetched hymn ${hit.hymn_no} from AdventistHymns.com.`, 'success');
    }
  } catch (err) {
    console.error(err);
    setLyricsText('');
    setStatus(`Failed to load hymn ${hit.hymn_no}: ${err?.message || String(err)}`, 'error');
  } finally {
    isFetchingLyrics = false;
  }
}

async function displayHit(hit, options = {}) {
  currentHit = hit;
  hasLyricsLoaded = false;
  currentSourceUrl = '';
  detailsPanel.hidden = false;
  selectedTitle.textContent = hit.hymn_title || `Hymn ${hit.hymn_no}`;
  selectedSubtitle.textContent = `Hymn #${hit.hymn_no}`;
  licenseValue.textContent = formatLicense(hit.license);
  sourceValue.textContent = getSourceLabel(hit);
  wordsValue.textContent = hit.words || 'Unknown';
  ccliSongValue.textContent = hit.cclisong || 'Not listed';
  openSongSelectButton.hidden = !getSongSelectUrl(hit?.cclisong);
  setLyricsText('');
  updateLicenseMessage(hit);
  if (options.updateResults) {
    const visibleResults = Array.from(resultsList.querySelectorAll('.result-row'));
    visibleResults.forEach((button) => button.classList.remove('selected'));
    const selectedButton = visibleResults.find((button) => button.textContent.includes(`#${hit.hymn_no}`));
    if (selectedButton) selectedButton.classList.add('selected');
  }

  await loadLyricsForHit(hit, {
    autoFetch: normalizeText(hit.license) === 'public'
  });
}

function searchHymns(query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) {
    clearSelectionState();
    setStatus('Enter a hymn number or title.');
    return [];
  }

  const normalizedQuery = normalizeText(trimmed);
  const numericQuery = normalizeNumber(trimmed);

  if (numericQuery) {
    const directHit = hymnIndex.find((row) => normalizeNumber(row?.hymn_no) === numericQuery);
    if (directHit) return [directHit];
  }

  return hymnIndex.filter((row) => normalizeText(row?.hymn_title).includes(normalizedQuery));
}

async function runSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    clearSelectionState();
    setStatus('Enter a hymn number or title.');
    return false;
  }

  const results = searchHymns(query);
  if (!results.length) {
    clearSelectionState();
    setStatus(`No hymns matched "${query}".`);
    return false;
  }

  lastResolvedQuery = query;

  const numericQuery = normalizeNumber(query);
  if (numericQuery && normalizeNumber(results[0]?.hymn_no) === numericQuery) {
    renderResults([results[0]]);
    await displayHit(results[0], { updateResults: true });
    return true;
  }

  if (results.length === 1) {
    renderResults(results);
    await displayHit(results[0], { updateResults: true });
    return true;
  }

  currentHit = null;
  currentSourceUrl = '';
  hasLyricsLoaded = false;
  detailsPanel.hidden = true;
  setLyricsText('');
  renderResults(results);
  setStatus(`${results.length} hymns matched "${query}". Select one from the list.`);
  return true;
}

async function buildCurrentMarkdown() {
  if (!currentHit) {
    throw new Error('Select a hymn first.');
  }
  if (!lyricsBox.value.trim()) {
    throw new Error('Lyrics are empty.');
  }

  const markdown = await window.electronAPI.pluginTrigger('adventisthymns', 'buildLyricsMarkdown', {
    number: currentHit.hymn_no,
    title: currentHit.hymn_title,
    lyrics: lyricsBox.value,
    sourceUrl: currentSourceUrl,
    hymnIndexEntry: currentHit
  });
  if (!String(markdown || '').trim()) {
    throw new Error('Unable to prepare hymn markdown.');
  }
  return markdown;
}

async function runInsert() {
  if (isInserting) return false;
  if (!currentHit) {
    alert('Select a hymn first.');
    return false;
  }
  if (!lyricsBox.value.trim()) {
    alert('Load lyrics first.');
    return false;
  }

  isInserting = true;
  insertButton.disabled = true;
  try {
    const markdown = await buildCurrentMarkdown();
    if (returnKey) {
      localStorage.setItem(returnKey, JSON.stringify({ markdown }));
      window.close();
      return true;
    }

    if (!slug || !mdFile) {
      throw new Error('No presentation is active.');
    }

    const result = await window.electronAPI.pluginTrigger('adventisthymns', 'insertHymnMarkdown', {
      slug,
      mdFile,
      markdown
    });
    if (!result?.success) {
      throw new Error('The hymn could not be inserted.');
    }
    setStatus(`Inserted hymn ${currentHit.hymn_no} into ${mdFile}.`, 'success');
    setTimeout(() => window.close(), 600);
    return true;
  } catch (err) {
    console.error(err);
    setStatus(err?.message || String(err), 'error');
    return false;
  } finally {
    isInserting = false;
    insertButton.disabled = false;
  }
}

fetchLyricsButton.addEventListener('click', async () => {
  if (!currentHit) return;
  await loadLyricsForHit(currentHit, { autoFetch: true });
});

openSongSelectButton.addEventListener('click', () => {
  const url = getSongSelectUrl(currentHit?.cclisong);
  if (!url) return;
  if (window.electronAPI?.openExternalURL) {
    window.electronAPI.openExternalURL(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
});

searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await runSearch();
});

insertButton.addEventListener('click', async () => {
  await runInsert();
});

searchInput.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const currentQuery = searchInput.value.trim();
  if (
    currentHit &&
    hasLyricsLoaded &&
    currentQuery &&
    currentQuery === lastResolvedQuery &&
    !isFetchingLyrics
  ) {
    await runInsert();
    return;
  }
  await runSearch();
});

async function init() {
  setStatus('Loading hymn index...');
  try {
    const [{ hymnIndex: loadedIndex }, appConfig] = await Promise.all([
      window.electronAPI.pluginTrigger('adventisthymns', 'getHymnIndex'),
      window.electronAPI.getAppConfig()
    ]);
    hymnIndex = Array.isArray(loadedIndex) ? loadedIndex : [];
    ccliConfigured = Boolean(String(appConfig?.pluginConfigs?.credit_ccli?.licenseNumber || '').trim());
    if (!hymnIndex.length) {
      setStatus('The hymn index is unavailable.', 'error');
      searchButton.disabled = true;
      insertButton.disabled = true;
      return;
    }
    setStatus(`Loaded ${hymnIndex.length} hymns.`);
  } catch (err) {
    console.error(err);
    setStatus(`Failed to load hymn index: ${err?.message || String(err)}`, 'error');
    searchButton.disabled = true;
    insertButton.disabled = true;
    return;
  }

  searchInput.focus();
  searchInput.select();
}

init();
