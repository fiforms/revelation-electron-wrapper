/*
 * Import Presentation window (import-presentation.html; ?tab=pdf selects the PDF tab).
 *
 * Two tabs: "revelation" (import a .zip via electronAPI.selectImportPresentationZip /
 * importPresentationZip, or a published presentation URL via importPresentationFromUrl) and
 * "pdf" (PDF / PowerPoint: createPresentation, then the addmedia plugin's `bulk-import-pdf`
 * through pluginTrigger, then exportImages for the thumbnail and openPresentationBuilder).
 * PowerPoint needs LibreOffice (electronAPI.detectLibreOffice).
 * i18n: loads /js/translate.js (classic script, before this module); static text uses
 * data-translate in the HTML, placeholders/dynamic strings go through t()/tf() here
 * (keys in locales/translations.json). Messages from the main process (res.message, res.error)
 * and data (paths, slugs) are shown as-is.
 */
window.translationsources ||= [];
window.translationsources.push('/admin/locales/translations.json');

function t(key) {
  if (typeof window.tr === 'function') return window.tr(key);
  return key;
}

// Translate a template and fill {placeholders} from vars.
function tf(key, vars = {}) {
  let out = t(key);
  for (const [name, value] of Object.entries(vars)) {
    out = out.split(`{${name}}`).join(String(value));
  }
  return out;
}

// Make sure translations are loaded before the first status message is written.
if (!window.translationsLoaded && typeof window.loadTranslations === 'function') {
  await window.loadTranslations();
}

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
const result = document.getElementById('import-status');
const closeBtn = document.getElementById('close-btn');
const tabButtons = Array.from(document.querySelectorAll('.tab-button[data-tab]'));

const pdfTitleInput = document.getElementById('pdf-title');
const pdfSlugInput = document.getElementById('pdf-slug');
const pdfChooseBtn = document.getElementById('pdf-choose-btn');
const pdfPathInput = document.getElementById('pdf-path');
const pdfPageSizeEl = document.getElementById('pdf-page-size');
const pptxChooseBtn = document.getElementById('pptx-choose-btn');
const pptxNotesField = document.getElementById('pptx-notes-field');
const pptxPathInput = document.getElementById('pptx-path');
const pdfResolutionSelect = document.getElementById('pdf-resolution');
const pdfAdvancedInput = document.getElementById('pdf-advanced');
const pdfAdvancedFields = Array.from(document.querySelectorAll('#tab-pdf [data-advanced]'));
const pdfHelpBtn = document.getElementById('pdf-help-btn');

zipPathInput.placeholder = t('No file selected');
pdfPathInput.placeholder = t('No file selected');
pptxPathInput.placeholder = t('No PPTX selected');

const state = {
  tab: 'revelation',
  mode: null,
  zipPath: '',
  url: '',
  busy: false
};

const pdfState = {
  pdfPath: '',
  sourcePath: '',
  pptxPath: '',
  slugEdited: false,
  slugSuffix: null
};
let closeTimer = null;

function setStatus(message, type = 'info') {
  result.textContent = message;
  result.dataset.type = type;
}

function validationSuffix(validation) {
  if (!validation) return '';
  if (validation.passed) {
    const n = validation.checked;
    return ` — ${tf('Validation passed ({count} file(s) checked)', { count: n })}`;
  }
  return ` — ${tf('Imported with {count} validation error(s)', { count: validation.errors.length })}`;
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
    throw new Error(t('Enter a presentation URL.'));
  }
  const parsed = new URL(trimmed);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(t('URL must start with http:// or https://'));
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
  updateImportButton();
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
  updateImportButton();
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

function updateImportButton() {
  if (state.busy) {
    importBtn.disabled = true;
    return;
  }
  if (state.tab === 'pdf') {
    importBtn.disabled = !(pdfState.pdfPath || pdfState.sourcePath) || !pdfTitleInput.value.trim();
    return;
  }
  importBtn.disabled = !state.mode;
}

function setBusy(isBusy) {
  state.busy = isBusy;
  chooseZipBtn.disabled = isBusy || state.mode === 'url';
  urlInput.disabled = isBusy || state.mode === 'zip';
  suggestSlugBtn.disabled = isBusy;
  changeSourceBtn.disabled = isBusy;
  closeBtn.disabled = isBusy;
  tabButtons.forEach((btn) => { btn.disabled = isBusy; });
  [pdfTitleInput, pdfSlugInput, pdfChooseBtn, pdfResolutionSelect, pdfAdvancedInput]
    .forEach((el) => { el.disabled = isBusy; });
  // Notes come from the source itself when a PowerPoint file was chosen.
  pptxChooseBtn.disabled = isBusy || !!pdfState.sourcePath;
  updateImportButton();
}

function selectTab(tab) {
  state.tab = tab;
  tabButtons.forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    document.getElementById(btn.getAttribute('aria-controls')).hidden = !active;
  });
  updateImportButton();
  if (tab === 'pdf') {
    setStatus(pdfState.pdfPath || pdfState.sourcePath ? t('Ready to import.') : t('Enter a title and choose a PDF or PowerPoint file to begin.'));
    if (!pdfTitleInput.value) pdfTitleInput.focus();
  } else {
    setStatus(state.mode ? t('Confirm slug and click Import.') : t('Choose ZIP or URL to begin import.'));
  }
}

function selectUrlSource(rawUrl, showErrors = true) {
  try {
    state.url = validateUrl(rawUrl);
    lockMode('url');
    suggestCurrentSlug();
    setStatus(t('URL selected. Confirm slug and click Import.'));
    return true;
  } catch (err) {
    if (showErrors) {
      setStatus(err.message || t('Invalid URL.'), 'error');
    }
    return false;
  }
}

chooseZipBtn.addEventListener('click', async () => {
  setStatus(t('Opening ZIP picker...'));
  setBusy(true);

  try {
    const res = await window.electronAPI.selectImportPresentationZip();
    if (!res || res.canceled) {
      setStatus(t('ZIP selection canceled.'));
      return;
    }
    if (!res.success) {
      setStatus(tf('ZIP selection failed: {error}', { error: res.error || t('Unknown error') }), 'error');
      return;
    }

    state.zipPath = res.zipPath || '';
    zipPathInput.value = state.zipPath;
    lockMode('zip');

    slugInput.value = res.suggestedSlug || '';
    if (!slugInput.value) {
      suggestCurrentSlug();
    }

    setStatus(t('ZIP selected. Confirm slug and click Import.'));
  } catch (err) {
    setStatus(tf('ZIP selection failed: {error}', { error: err.message || err }), 'error');
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
    setStatus(t('Choose a source first.'), 'error');
    return;
  }
  suggestCurrentSlug();
  if (slugInput.value) {
    setStatus(tf('Suggested slug: {slug}', { slug: slugInput.value }));
  } else {
    setStatus(t('Unable to suggest a slug from current source.'), 'error');
  }
});

changeSourceBtn.addEventListener('click', () => {
  unlockMode();
  setStatus(t('Source reset. Choose ZIP or URL.'));
});

importBtn.addEventListener('click', () => {
  if (state.tab === 'pdf') {
    runPdfImport();
    return;
  }
  runRevelationImport();
});

async function runRevelationImport() {
  if (!state.mode) {
    setStatus(t('Choose a source first.'), 'error');
    return;
  }

  const slug = slugInput.value.trim();
  if (!slug) {
    setStatus(t('Enter a destination slug.'), 'error');
    slugInput.focus();
    return;
  }

  setBusy(true);
  setStatus(t('Importing...'));

  try {
    if (state.mode === 'zip') {
      const res = await window.electronAPI.importPresentationZip({
        zipPath: state.zipPath,
        slug
      });

      if (!res?.success) {
        setStatus(tf('ZIP import failed: {error}', { error: res?.error || t('Unknown error') }), 'error');
        return;
      }

      const zipMsg = (res.message || tf('Imported ZIP into {slug}', { slug: res.slug })) + validationSuffix(res.validation);
      const zipType = res.validation && !res.validation.passed ? 'warning' : 'success';
      setStatus(zipMsg, zipType);
      scheduleAutoClose();
      return;
    }

    const res = await window.electronAPI.importPresentationFromUrl({
      url: state.url,
      slug
    });

    if (!res?.success) {
      setStatus(tf('URL import failed: {error}', { error: res?.error || t('Unknown error') }), 'error');
      return;
    }

    const urlMsg = (res.message || tf('Imported {count} files into {slug}', { count: res.downloaded || 0, slug: res.slug })) + validationSuffix(res.validation);
    const urlType = res.validation && !res.validation.passed ? 'warning' : 'success';
    setStatus(urlMsg, urlType);
    scheduleAutoClose();
  } catch (err) {
    setStatus(tf('Import failed: {error}', { error: err.message || err }), 'error');
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------------------
// PDF / PowerPoint import: create a new presentation, then reuse the addmedia
// plugin's PDF import (same path as Add Content -> PDF in the builder).
// ---------------------------------------------------------------------------

const PDF_THUMBNAIL = { width: 853, height: 480, delay: 2 };

function suggestPdfSlug() {
  if (pdfState.slugEdited) return;
  if (!pdfState.slugSuffix) pdfState.slugSuffix = randomFourDigits();
  const base = slugify(pdfTitleInput.value) || 'presentation';
  pdfSlugInput.value = `${base}-${pdfState.slugSuffix}`;
}

function titleFromFilename(filename) {
  return String(filename || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_]+/g, ' ')
    .trim();
}

async function callAddMedia(invoke, data) {
  if (!window.electronAPI?.pluginTrigger) {
    throw new Error(t('PDF import is only available in the desktop app.'));
  }
  const res = await window.electronAPI.pluginTrigger('addmedia', invoke, data);
  if (res === 1 || res === undefined) {
    throw new Error(t('The Add Media plugin is not loaded. Enable it in Settings and restart the app.'));
  }
  return res;
}

function showPopplerHelp(show) {
  pdfHelpBtn.hidden = !show;
}

// Advanced options (slug, PPTX notes, resolution) stay hidden unless ticked; the
// choice is remembered per viewer. Hidden fields keep their values and defaults.
const ADVANCED_STORAGE_KEY = 'importPresentation.pdfAdvanced';

function applyPdfAdvanced(show) {
  pdfAdvancedFields.forEach((el) => { el.hidden = !show; });
}

pdfAdvancedInput.addEventListener('change', () => {
  applyPdfAdvanced(pdfAdvancedInput.checked);
  try {
    localStorage.setItem(ADVANCED_STORAGE_KEY, pdfAdvancedInput.checked ? '1' : '0');
  } catch {
    // Storage unavailable; the toggle still works for this session.
  }
});

try {
  pdfAdvancedInput.checked = localStorage.getItem(ADVANCED_STORAGE_KEY) === '1';
} catch {
  pdfAdvancedInput.checked = false;
}
applyPdfAdvanced(pdfAdvancedInput.checked);

pdfTitleInput.addEventListener('input', () => {
  suggestPdfSlug();
  updateImportButton();
});

pdfSlugInput.addEventListener('input', () => {
  pdfState.slugEdited = pdfSlugInput.value.trim() !== '';
});

pdfSlugInput.addEventListener('blur', () => {
  const cleaned = slugify(pdfSlugInput.value);
  if (cleaned) {
    pdfSlugInput.value = cleaned;
  } else {
    pdfState.slugEdited = false;
    suggestPdfSlug();
  }
});

const LIBREOFFICE_MISSING = t('LibreOffice was not found. See the note above.');
const LIBREOFFICE_DOWNLOAD_URL = 'https://www.libreoffice.org/download/download-libreoffice/';
const libreofficeNotice = document.getElementById('libreoffice-notice');
const libreofficeRecheckBtn = document.getElementById('libreoffice-recheck-btn');

function showLibreOfficeNotice(show) {
  libreofficeNotice.hidden = !show;
}

// Returns true when LibreOffice is available, showing the install notice otherwise.
// If detection itself is unavailable, assume it's there and let the import report errors.
async function checkLibreOffice() {
  const found = await window.electronAPI.detectLibreOffice?.();
  const available = !found || !!found.path;
  showLibreOfficeNotice(!available);
  return available;
}

document.getElementById('libreoffice-download-link').addEventListener('click', (event) => {
  event.preventDefault();
  if (window.electronAPI?.openExternalURL) {
    window.electronAPI.openExternalURL(LIBREOFFICE_DOWNLOAD_URL);
  } else {
    window.open(LIBREOFFICE_DOWNLOAD_URL, '_blank');
  }
});

libreofficeRecheckBtn.addEventListener('click', async () => {
  libreofficeRecheckBtn.disabled = true;
  try {
    if (await checkLibreOffice()) {
      setStatus(t('LibreOffice found. Ready to import.'), 'success');
    } else {
      setStatus(t('LibreOffice still not found.'), 'warning');
    }
  } finally {
    libreofficeRecheckBtn.disabled = false;
  }
});

function setPptxNotesFromSource(isPowerPoint) {
  pptxNotesField.classList.toggle('is-disabled', isPowerPoint);
  if (isPowerPoint) {
    pdfState.pptxPath = '';
    pptxPathInput.value = '';
    pptxPathInput.title = '';
  }
}

pdfChooseBtn.addEventListener('click', async () => {
  setStatus(t('Select a PDF or PowerPoint file…'));
  setBusy(true);
  showPopplerHelp(false);
  try {
    const res = await callAddMedia('bulk-pdf-select', { standalone: true, allowPowerPoint: true });
    if (res?.canceled) {
      setStatus(t('File selection canceled.'));
      return;
    }
    if (!res?.success) {
      showPopplerHelp(!!res?.missingPoppler);
      setStatus(res?.missingPoppler
        ? t('Poppler was not found. Install it to import PDFs.')
        : tf('File selection failed: {error}', { error: res?.error || t('Unknown error') }), 'error');
      return;
    }

    const chosenPath = res.kind === 'powerpoint' ? res.sourcePath : res.pdfPath;
    pdfState.pdfPath = res.kind === 'powerpoint' ? '' : res.pdfPath;
    pdfState.sourcePath = res.kind === 'powerpoint' ? res.sourcePath : '';
    pdfPathInput.value = chosenPath;
    pdfPathInput.title = chosenPath;
    setPptxNotesFromSource(res.kind === 'powerpoint');
    showLibreOfficeNotice(false);

    if (!pdfTitleInput.value.trim()) {
      pdfTitleInput.value = titleFromFilename(res.filename);
      suggestPdfSlug();
    }

    if (res.kind === 'powerpoint') {
      pdfPageSizeEl.textContent = t('Presentation file: will be converted with LibreOffice. Speaker notes will be imported.');
      if (!(await checkLibreOffice())) {
        setStatus(LIBREOFFICE_MISSING, 'warning');
        return;
      }
      setStatus(t('Ready to import.'));
      return;
    }

    if (res.page?.widthPts && res.page?.heightPts) {
      const w = Math.round((res.page.widthPts / 72) * 100) / 100;
      const h = Math.round((res.page.heightPts / 72) * 100) / 100;
      pdfPageSizeEl.textContent = tf('Page 1: {w} × {h} in. All pages are assumed to match.', { w, h });
    }
    setStatus(t('Ready to import.'));
  } catch (err) {
    setStatus(err.message || String(err), 'error');
  } finally {
    setBusy(false);
  }
});

pptxChooseBtn.addEventListener('click', async () => {
  setBusy(true);
  try {
    const res = await callAddMedia('bulk-pptx-select', { standalone: true });
    if (res?.canceled) return;
    if (!res?.success) {
      setStatus(tf('PPTX selection failed: {error}', { error: res?.error || t('Unknown error') }), 'error');
      return;
    }
    pdfState.pptxPath = res.pptxPath;
    pptxPathInput.value = res.pptxPath;
    pptxPathInput.title = res.pptxPath;
    setStatus(t('PPTX selected. Speaker notes will be added to matching slides.'));
  } catch (err) {
    setStatus(err.message || String(err), 'error');
  } finally {
    setBusy(false);
  }
});

pdfHelpBtn.addEventListener('click', () => {
  const url = 'https://github.com/fiforms/revelation-electron-wrapper/blob/main/doc/dev/README-PDF.md';
  if (window.electronAPI?.openExternalURL) {
    window.electronAPI.openExternalURL(url);
  } else {
    window.open(url, '_blank');
  }
});

async function runPdfImport() {
  const title = pdfTitleInput.value.trim();
  if (!title) {
    setStatus(t('Enter a title.'), 'error');
    pdfTitleInput.focus();
    return;
  }
  if (!pdfState.pdfPath && !pdfState.sourcePath) {
    setStatus(t('Choose a PDF or PowerPoint file first.'), 'error');
    return;
  }
  const slug = slugify(pdfSlugInput.value);
  if (!slug) {
    setStatus(t('Enter a destination slug.'), 'error');
    pdfSlugInput.focus();
    return;
  }

  setBusy(true);
  showPopplerHelp(false);
  let createdSlug = null;

  try {
    // Check before creating anything, so a missing LibreOffice doesn't leave an empty presentation.
    if (pdfState.sourcePath) {
      if (!(await checkLibreOffice())) {
        setStatus(LIBREOFFICE_MISSING, 'error');
        return;
      }
    }

    setStatus(t('Creating presentation…'));
    const created = await window.electronAPI.createPresentation({
      title,
      slug,
      theme: 'revelation_dark.css',
      // createPresentation copies the template style.css into the new folder.
      stylesheet: 'style.css',
      // width/height are provisional; the import resizes them to the page aspect ratio.
      config: {
        transition: 'fade',
        width: 1280,
        height: 720,
        maxScale: 4.0
      },
      createTitleSlide: false,
      skipThumbnail: true
    });
    if (!created?.success || !created.slug) {
      setStatus(tf('Could not create presentation: {error}', { error: created?.error || t('Unknown error') }), 'error');
      return;
    }
    createdSlug = created.slug;

    setStatus(pdfState.sourcePath
      ? t('Converting PowerPoint with LibreOffice, then rendering pages… this can take a minute or two.')
      : t('Converting PDF pages… this can take a minute for large files.'));
    const imported = await callAddMedia('bulk-import-pdf', {
      slug: createdSlug,
      mdFile: 'presentation.md',
      pdfPath: pdfState.pdfPath || null,
      sourcePath: pdfState.sourcePath || null,
      pptxPath: pdfState.pptxPath || null,
      preset: pdfResolutionSelect.value,
      folderName: 'pdf_import_01',
      appendToMarkdown: true,
      // Presentation is 720 tall; width is set from the page aspect ratio.
      fitConfigHeight: 720
    });
    if (!imported?.success) {
      showPopplerHelp(!!imported?.missingPoppler);
      showLibreOfficeNotice(!!imported?.missingLibreOffice);
      const reason = imported?.missingLibreOffice ? LIBREOFFICE_MISSING : (imported?.error || t('Unknown error'));
      setStatus(tf('Presentation "{slug}" was created, but the import failed: {reason}', { slug: createdSlug, reason }), 'error');
      return;
    }

    setStatus(t('Generating thumbnail…'));
    try {
      await window.electronAPI.exportImages(
        createdSlug, 'presentation.md',
        PDF_THUMBNAIL.width, PDF_THUMBNAIL.height, PDF_THUMBNAIL.delay, true
      );
    } catch (err) {
      console.warn('Thumbnail generation failed:', err);
    }

    setStatus(tf('Imported {count} pages into {slug}. Opening builder…', { count: imported.count || 0, slug: createdSlug }), 'success');
    await window.electronAPI.openPresentationBuilder(createdSlug, 'presentation.md');
    setTimeout(() => window.close(), 400);
  } catch (err) {
    const message = err.message || err;
    setStatus(createdSlug
      ? tf('Presentation "{slug}" was created, but import failed: {error}', { slug: createdSlug, error: message })
      : tf('Import failed: {error}', { error: message }), 'error');
  } finally {
    setBusy(false);
  }
}

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => selectTab(btn.dataset.tab));
});

closeBtn.addEventListener('click', () => window.close());

slugSection.hidden = true;
selectTab(new URLSearchParams(window.location.search).get('tab') === 'pdf' ? 'pdf' : 'revelation');
