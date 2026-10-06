// plugins/addmedia/bulk-pdf.js  (page script for bulk-pdf.html)
// UI for importing a PDF or PowerPoint deck as one image slide per page. Calls the
// 'bulk-pdf-select' / 'bulk-pptx-select' / 'bulk-import-pdf' / 'check-folder-exists' /
// 'get-next-folder-name' api methods in plugin.js, which shell out to Poppler.
document.addEventListener('DOMContentLoaded', () => {
  const status = document.getElementById('status');
  const closeBtn = document.getElementById('closeBtn');
  const selectBtn = document.getElementById('selectBtn');
  const selectPptxBtn = document.getElementById('selectPptxBtn');
  const importBtn = document.getElementById('importBtn');
  const helpBtn = document.getElementById('helpBtn');
  const fileNameEl = document.getElementById('fileName');
  const fileHintEl = document.getElementById('fileHint');
  const pptxField = document.getElementById('pptxField');
  const pptxNameEl = document.getElementById('pptxName');
  const resolutionEl = document.getElementById('resolution');
  const folderNameEl = document.getElementById('folderName');
  const folderNameNoteEl = document.getElementById('folderNameNote');
  const advancedToggle = document.getElementById('advancedToggle');
  const advancedFields = Array.from(document.querySelectorAll('[data-advanced]'));
  const libreofficeNotice = document.getElementById('libreofficeNotice');
  const libreofficeRecheckBtn = document.getElementById('libreofficeRecheckBtn');

  const FOLDER_HINT = folderNameNoteEl.textContent;
  const ADVANCED_STORAGE_KEY = 'addmedia.bulkPdfAdvanced';
  const LIBREOFFICE_DOWNLOAD_URL = 'https://www.libreoffice.org/download/download-libreoffice/';
  const LIBREOFFICE_MISSING = 'LibreOffice was not found. See the note above.';

  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');
  const mdFile = urlParams.get('md');
  const returnKey = urlParams.get('returnKey');
  const tagType = urlParams.get('tagType') || 'normal';

  // pdfPath: a PDF to import directly; sourcePath: a PowerPoint file converted with LibreOffice.
  let pdfPath = null;
  let sourcePath = null;
  let pptxPath = null;

  const setStatus = (message, type = 'info') => {
    status.textContent = message;
    status.dataset.type = type;
  };

  const openExternal = (url) => {
    if (window.electronAPI?.openExternalURL) {
      window.electronAPI.openExternalURL(url);
    } else {
      window.open(url, '_blank');
    }
  };

  closeBtn.addEventListener('click', () => window.close());
  helpBtn.addEventListener('click', () => {
    openExternal('https://github.com/fiforms/revelation-electron-wrapper/blob/main/doc/dev/README-PDF.md');
  });

  // Advanced options (notes PPTX, resolution, folder) stay hidden unless ticked;
  // hidden fields keep their values and defaults. The choice is remembered per viewer.
  const applyAdvanced = (show) => {
    advancedFields.forEach((el) => { el.hidden = !show; });
  };
  try {
    advancedToggle.checked = localStorage.getItem(ADVANCED_STORAGE_KEY) === '1';
  } catch {
    advancedToggle.checked = false;
  }
  applyAdvanced(advancedToggle.checked);
  advancedToggle.addEventListener('change', () => {
    applyAdvanced(advancedToggle.checked);
    try {
      localStorage.setItem(ADVANCED_STORAGE_KEY, advancedToggle.checked ? '1' : '0');
    } catch {
      // Storage unavailable; the toggle still works for this session.
    }
  });

  if (!window.electronAPI?.pluginTrigger) {
    setStatus('This action is only available in the desktop app.', 'error');
    selectBtn.disabled = true;
    return;
  }
  if (!slug || !returnKey) {
    setStatus('Missing presentation info.', 'error');
    selectBtn.disabled = true;
    return;
  }

  const setBusy = (isBusy) => {
    selectBtn.disabled = isBusy;
    // Notes come from the source itself when a PowerPoint file was chosen.
    selectPptxBtn.disabled = isBusy || !!sourcePath;
    resolutionEl.disabled = isBusy;
    folderNameEl.disabled = isBusy;
    advancedToggle.disabled = isBusy;
    closeBtn.disabled = isBusy;
    importBtn.disabled = isBusy || !(pdfPath || sourcePath);
  };

  const showLibreOfficeNotice = (show) => {
    libreofficeNotice.hidden = !show;
  };

  // Returns true when LibreOffice is available, showing the install notice otherwise.
  const checkLibreOffice = async () => {
    const found = await window.electronAPI.detectLibreOffice?.();
    const available = !found || !!found.path;
    showLibreOfficeNotice(!available);
    return available;
  };

  document.getElementById('libreofficeDownloadLink').addEventListener('click', (event) => {
    event.preventDefault();
    openExternal(LIBREOFFICE_DOWNLOAD_URL);
  });

  libreofficeRecheckBtn.addEventListener('click', async () => {
    libreofficeRecheckBtn.disabled = true;
    try {
      if (await checkLibreOffice()) {
        setStatus('LibreOffice found. Ready to import.', 'success');
      } else {
        setStatus('LibreOffice still not found.', 'warning');
      }
    } finally {
      libreofficeRecheckBtn.disabled = false;
    }
  });

  const getNextFolderName = async () => {
    try {
      const result = await window.electronAPI.pluginTrigger('addmedia', 'get-next-folder-name', { slug });
      return result?.folderName || 'pdf_import_01';
    } catch (err) {
      return 'pdf_import_01';
    }
  };

  const setFolderError = (message) => {
    folderNameNoteEl.textContent = message || FOLDER_HINT;
    folderNameNoteEl.style.color = message ? '#ff6b6b' : '';
  };

  const validateFolderName = async (folderName) => {
    const trimmed = String(folderName || '').trim();
    if (!trimmed) {
      setFolderError('Folder name is required.');
      return false;
    }
    if (!/^[a-zA-Z0-9_\-]+$/.test(trimmed)) {
      setFolderError('Folder name can only contain letters, numbers, underscores, and hyphens.');
      return false;
    }
    try {
      const result = await window.electronAPI.pluginTrigger('addmedia', 'check-folder-exists', {
        slug,
        folderName: trimmed
      });
      if (result?.exists) {
        setFolderError('This folder already exists. Choose a different name.');
        return false;
      }
    } catch (err) {
      // Let the import itself report folder problems.
    }
    setFolderError('');
    return true;
  };

  folderNameEl.addEventListener('input', () => validateFolderName(folderNameEl.value));
  getNextFolderName().then((name) => {
    if (!folderNameEl.value) folderNameEl.value = name;
  });

  const setPptxNotesFromSource = (isPowerPoint) => {
    pptxField.classList.toggle('is-disabled', isPowerPoint);
    if (isPowerPoint) {
      pptxPath = null;
      pptxNameEl.value = '';
    }
  };

  selectBtn.addEventListener('click', async () => {
    setStatus('Select a PowerPoint or PDF file…');
    setBusy(true);
    helpBtn.hidden = true;

    try {
      const result = await window.electronAPI.pluginTrigger('addmedia', 'bulk-pdf-select', {
        slug,
        mdFile,
        allowPowerPoint: true
      });

      if (!result || result === 1) {
        setStatus('File selection failed (plugin not loaded). Restart the app.', 'error');
        return;
      }
      if (result.canceled) {
        setStatus('Selection canceled.');
        return;
      }
      if (!result.success) {
        helpBtn.hidden = !result.missingPoppler;
        setStatus(result.missingPoppler
          ? 'Poppler was not found. Install it to import PDFs.'
          : `Error: ${result.error || 'File selection failed.'}`, 'error');
        return;
      }

      const isPowerPoint = result.kind === 'powerpoint';
      pdfPath = isPowerPoint ? null : result.pdfPath;
      sourcePath = isPowerPoint ? result.sourcePath : null;
      fileNameEl.value = (isPowerPoint ? result.sourcePath : result.pdfPath) || result.filename || '';
      fileNameEl.title = fileNameEl.value;
      setPptxNotesFromSource(isPowerPoint);
      showLibreOfficeNotice(false);

      if (isPowerPoint) {
        fileHintEl.textContent = 'Presentation file: will be converted with LibreOffice. Speaker notes will be imported.';
        if (!(await checkLibreOffice())) {
          setStatus(LIBREOFFICE_MISSING, 'warning');
          return;
        }
      } else if (result.page?.widthPts && result.page?.heightPts) {
        const w = Math.round((result.page.widthPts / 72) * 100) / 100;
        const h = Math.round((result.page.heightPts / 72) * 100) / 100;
        fileHintEl.textContent = `Page 1: ${w} × ${h} in. All pages are assumed to match.`;
      }
      setStatus('Ready to import.');
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  });

  selectPptxBtn.addEventListener('click', async () => {
    setBusy(true);
    try {
      const result = await window.electronAPI.pluginTrigger('addmedia', 'bulk-pptx-select', {
        slug,
        mdFile
      });

      if (!result || result === 1) {
        setStatus('PPTX selection failed (plugin not loaded). Restart the app.', 'error');
        return;
      }
      if (result.canceled) return;
      if (!result.success) {
        setStatus(`Error: ${result.error || 'PPTX selection failed.'}`, 'error');
        return;
      }
      pptxPath = result.pptxPath || null;
      pptxNameEl.value = result.pptxPath || result.filename || '';
      pptxNameEl.title = pptxNameEl.value;
      setStatus('PPTX selected. Speaker notes will be added to matching slides.');
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  });

  importBtn.addEventListener('click', async () => {
    if (!pdfPath && !sourcePath) {
      setStatus('Choose a PowerPoint or PDF file first.', 'error');
      return;
    }

    if (!(await validateFolderName(folderNameEl.value))) {
      // The folder field may be tucked away under Advanced options.
      advancedToggle.checked = true;
      applyAdvanced(true);
      folderNameEl.focus();
      setStatus('Fix the folder name error.', 'error');
      return;
    }

    setBusy(true);
    helpBtn.hidden = true;

    try {
      if (sourcePath && !(await checkLibreOffice())) {
        setStatus(LIBREOFFICE_MISSING, 'error');
        return;
      }

      setStatus(sourcePath
        ? 'Converting PowerPoint with LibreOffice, then rendering pages… this can take a minute or two.'
        : 'Converting PDF pages… this can take a minute for large files.');

      const result = await window.electronAPI.pluginTrigger('addmedia', 'bulk-import-pdf', {
        slug,
        mdFile,
        tagType,
        pdfPath,
        sourcePath,
        pptxPath,
        preset: resolutionEl.value,
        folderName: folderNameEl.value.trim()
      });

      if (result?.success) {
        localStorage.setItem(returnKey, JSON.stringify({ markdown: result.markdown || '' }));
        setStatus(`Imported ${result.count || 0} pages at ${result.width || '?'}×${result.height || '?'} px.`, 'success');
        setTimeout(() => window.close(), 300);
        return;
      }

      if (result?.canceled) {
        localStorage.setItem(returnKey, JSON.stringify({ canceled: true }));
        setStatus('Import canceled.');
        setTimeout(() => window.close(), 200);
        return;
      }

      helpBtn.hidden = !result?.missingPoppler;
      showLibreOfficeNotice(!!result?.missingLibreOffice);
      setStatus(result?.missingLibreOffice
        ? LIBREOFFICE_MISSING
        : `Error: ${result?.error || 'Import failed.'}`, 'error');
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  });

  setStatus('Choose a PowerPoint or PDF file to begin.');
});
