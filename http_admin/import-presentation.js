const zipPathInput = document.getElementById('zip-path');
const urlInput = document.getElementById('import-url');
const slugInput = document.getElementById('import-slug');
const chooseZipBtn = document.getElementById('choose-zip-btn');
const suggestSlugBtn = document.getElementById('suggest-slug-btn');
const changeSourceBtn = document.getElementById('change-source-btn');
const importBtn = document.getElementById('import-btn');
const slugSection = document.getElementById('slug-section');
const zipSourceRow = document.getElementById('zip-source-row');
const urlSourceRow = document.getElementById('url-source-row');
const result = document.getElementById('result');

const state = {
  mode: null,
  zipPath: '',
  url: ''
};
let closeTimer = null;

function setStatus(message, type = 'info') {
  result.textContent = message;
  if (type === 'error') {
    result.style.color = '#ff6b6b';
    return;
  }
  if (type === 'success') {
    result.style.color = '#50d890';
    return;
  }
  result.style.color = '#f4f4f4';
}

function scheduleAutoClose() {
  if (closeTimer) {
    clearTimeout(closeTimer);
  }
  closeTimer = setTimeout(() => {
    window.close();
  }, 5000);
}

function randomFourDigits() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deriveSlugFromUrl(urlText) {
  let parsed;
  try {
    parsed = new URL(urlText);
  } catch {
    return '';
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  let base = parts.length ? parts[parts.length - 1] : 'presentation';
  if (/^index\.html?$/i.test(base) && parts.length > 1) {
    base = parts[parts.length - 2];
  }
  base = base.replace(/\.[a-z0-9]+$/i, '');
  base = slugify(base) || 'presentation';

  return `${base}-${randomFourDigits()}`;
}

function validateUrl(urlText) {
  const trimmed = String(urlText || '').trim();
  if (!trimmed) {
    throw new Error('Enter a presentation URL.');
  }
  const parsed = new URL(trimmed);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL must start with http:// or https://');
  }
  return trimmed;
}

function setSourceDisabled(el, disabled) {
  if (!el) return;
  el.classList.toggle('is-disabled', !!disabled);
}

function lockMode(mode) {
  state.mode = mode;
  const zipLocked = mode === 'url';
  const urlLocked = mode === 'zip';

  chooseZipBtn.disabled = zipLocked;
  urlInput.disabled = urlLocked;

  setSourceDisabled(zipSourceRow, zipLocked);
  setSourceDisabled(urlSourceRow, urlLocked);

  slugSection.hidden = false;
  importBtn.disabled = false;
}

function unlockMode() {
  state.mode = null;
  state.zipPath = '';
  state.url = '';

  chooseZipBtn.disabled = false;
  urlInput.disabled = false;

  zipPathInput.value = '';
  urlInput.value = '';
  slugInput.value = '';

  setSourceDisabled(zipSourceRow, false);
  setSourceDisabled(urlSourceRow, false);

  slugSection.hidden = true;
  importBtn.disabled = true;
}

function suggestCurrentSlug() {
  if (state.mode === 'zip') {
    const zipName = zipPathInput.value.split(/[\\/]/).pop() || '';
    const base = slugify(zipName.replace(/\.zip$/i, '')) || 'presentation';
    slugInput.value = `${base}-${randomFourDigits()}`;
    return;
  }
  if (state.mode === 'url') {
    const suggestion = deriveSlugFromUrl(state.url);
    if (suggestion) slugInput.value = suggestion;
  }
}

function setBusy(isBusy) {
  chooseZipBtn.disabled = isBusy || state.mode === 'url';
  urlInput.disabled = isBusy || state.mode === 'zip';
  suggestSlugBtn.disabled = isBusy;
  changeSourceBtn.disabled = isBusy;
  importBtn.disabled = isBusy;
}

function selectUrlSource(rawUrl, showErrors = true) {
  try {
    state.url = validateUrl(rawUrl);
    lockMode('url');
    suggestCurrentSlug();
    setStatus('URL selected. Confirm slug and click Import.');
    return true;
  } catch (err) {
    if (showErrors) {
      setStatus(err.message || 'Invalid URL.', 'error');
    }
    return false;
  }
}

chooseZipBtn.addEventListener('click', async () => {
  setStatus('Opening ZIP picker...');
  setBusy(true);

  try {
    const res = await window.electronAPI.selectImportPresentationZip();
    if (!res || res.canceled) {
      setStatus('ZIP selection canceled.');
      return;
    }
    if (!res.success) {
      setStatus(`ZIP selection failed: ${res.error || 'Unknown error'}`, 'error');
      return;
    }

    state.zipPath = res.zipPath || '';
    zipPathInput.value = state.zipPath;
    lockMode('zip');

    slugInput.value = res.suggestedSlug || '';
    if (!slugInput.value) {
      suggestCurrentSlug();
    }

    setStatus('ZIP selected. Confirm slug and click Import.');
  } catch (err) {
    setStatus(`ZIP selection failed: ${err.message || err}`, 'error');
  } finally {
    setBusy(false);
  }
});

urlInput.addEventListener('change', () => {
  if (state.mode || !urlInput.value.trim()) return;
  selectUrlSource(urlInput.value, true);
});

urlInput.addEventListener('paste', () => {
  if (state.mode) return;
  setTimeout(() => {
    if (state.mode || !urlInput.value.trim()) return;
    selectUrlSource(urlInput.value, false);
  }, 0);
});

suggestSlugBtn.addEventListener('click', () => {
  if (!state.mode) {
    setStatus('Choose a source first.', 'error');
    return;
  }
  suggestCurrentSlug();
  if (slugInput.value) {
    setStatus(`Suggested slug: ${slugInput.value}`);
  } else {
    setStatus('Unable to suggest a slug from current source.', 'error');
  }
});

changeSourceBtn.addEventListener('click', () => {
  unlockMode();
  setStatus('Source reset. Choose ZIP or URL.');
});

importBtn.addEventListener('click', async () => {
  if (!state.mode) {
    setStatus('Choose a source first.', 'error');
    return;
  }

  const slug = slugInput.value.trim();
  if (!slug) {
    setStatus('Enter a destination slug.', 'error');
    slugInput.focus();
    return;
  }

  setBusy(true);
  setStatus('Importing...');

  try {
    if (state.mode === 'zip') {
      const res = await window.electronAPI.importPresentationZip({
        zipPath: state.zipPath,
        slug
      });

      if (!res?.success) {
        setStatus(`ZIP import failed: ${res?.error || 'Unknown error'}`, 'error');
        return;
      }

      setStatus(res.message || `Imported ZIP into ${res.slug}`, 'success');
      scheduleAutoClose();
      return;
    }

    const res = await window.electronAPI.importPresentationFromUrl({
      url: state.url,
      slug
    });

    if (!res?.success) {
      setStatus(`URL import failed: ${res?.error || 'Unknown error'}`, 'error');
      return;
    }

    setStatus(res.message || `Imported ${res.downloaded || 0} files into ${res.slug}`, 'success');
    scheduleAutoClose();
  } catch (err) {
    setStatus(`Import failed: ${err.message || err}`, 'error');
  } finally {
    setBusy(false);
  }
});

importBtn.disabled = true;
slugSection.hidden = true;
setStatus('Choose ZIP or URL to begin import.');
