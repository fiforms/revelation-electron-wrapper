document.addEventListener('DOMContentLoaded', () => {
  const status = document.getElementById('status');
  const closeBtn = document.getElementById('closeBtn');
  const selectBtn = document.getElementById('selectBtn');
  const selectPptxBtn = document.getElementById('selectPptxBtn');
  const importBtn = document.getElementById('importBtn');
  const helpBtn = document.getElementById('helpBtn');
  const fileNameEl = document.getElementById('fileName');
  const pptxNameEl = document.getElementById('pptxName');
  const pageSizeEl = document.getElementById('pageSize');
  const folderNameEl = document.getElementById('folderName');
  const folderNameNoteEl = document.getElementById('folderNameNote');
  const targetWidthEl = document.getElementById('targetWidth');
  const targetHeightEl = document.getElementById('targetHeight');
  const targetDpiEl = document.getElementById('targetDpi');

  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');
  const mdFile = urlParams.get('md');
  const returnKey = urlParams.get('returnKey');
  const tagType = urlParams.get('tagType') || 'normal';

  let pdfPath = null;
  let pptxPath = null;
  let pageSize = null;
  closeBtn.addEventListener('click', () => window.close());
  helpBtn.addEventListener('click', () => {
    const url = 'https://github.com/fiforms/revelation-electron-wrapper/blob/main/doc/dev/README-PDF.md';
    if (window.electronAPI?.openExternalURL) {
      window.electronAPI.openExternalURL(url);
    } else {
      window.open(url, '_blank');
    }
  });

  if (!window.electronAPI?.pluginTrigger) {
    status.textContent = 'This action is only available in the desktop app.';
    importBtn.disabled = true;
    return;
  }
  if (!slug || !returnKey) {
    status.textContent = 'Missing presentation info.';
    selectBtn.disabled = true;
    importBtn.disabled = true;
    return;
  }

  const round = (value, digits = 0) => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  };

  const setInputsEnabled = (enabled) => {
    targetWidthEl.disabled = !enabled;
    targetHeightEl.disabled = !enabled;
    targetDpiEl.disabled = !enabled;
    folderNameEl.disabled = !enabled;
  };

  const getNextFolderName = async () => {
    try {
      const result = await window.electronAPI.pluginTrigger('addmedia', 'get-next-folder-name', {
        slug
      });
      return result?.folderName || 'pdf_import_01';
    } catch (err) {
      return 'pdf_import_01';
    }
  };

  const validateFolderName = async (folderName) => {
    if (!folderName || folderName.trim() === '') {
      folderNameNoteEl.textContent = 'Folder name is required.';
      folderNameNoteEl.style.color = '#d44747';
      return false;
    }
    const trimmed = folderName.trim();
    if (!/^[a-zA-Z0-9_\-]+$/.test(trimmed)) {
      folderNameNoteEl.textContent = 'Folder name can only contain letters, numbers, underscores, and hyphens.';
      folderNameNoteEl.style.color = '#d44747';
      return false;
    }
    try {
      const result = await window.electronAPI.pluginTrigger('addmedia', 'check-folder-exists', {
        slug,
        folderName: trimmed
      });
      if (result?.exists) {
        folderNameNoteEl.textContent = 'This folder already exists. Choose a different name.';
        folderNameNoteEl.style.color = '#d44747';
        return false;
      }
    } catch (err) {
      folderNameNoteEl.textContent = '';
      return true;
    }
    folderNameNoteEl.textContent = '';
    return true;
  };

  folderNameEl.addEventListener('input', () => validateFolderName(folderNameEl.value));

  const renderPageSize = () => {
    if (!pageSize) {
      pageSizeEl.textContent = 'Page 1 size: —';
      return;
    }
    const widthIn = round(pageSize.widthPts / 72, 2);
    const heightIn = round(pageSize.heightPts / 72, 2);
    pageSizeEl.textContent = `Page 1 size: ${pageSize.widthPts} x ${pageSize.heightPts} pts (${widthIn} x ${heightIn} in)`;
  };

  const updateFromWidth = () => {
    if (!pageSize) return;
    const width = Number(targetWidthEl.value);
    if (!Number.isFinite(width) || width <= 0) return;
    const ratio = pageSize.heightPts / pageSize.widthPts;
    const height = Math.max(1, Math.round(width * ratio));
    const dpi = round(width / (pageSize.widthPts / 72), 2);
    targetHeightEl.value = height;
    targetDpiEl.value = dpi;
  };

  const updateFromHeight = () => {
    if (!pageSize) return;
    const height = Number(targetHeightEl.value);
    if (!Number.isFinite(height) || height <= 0) return;
    const ratio = pageSize.widthPts / pageSize.heightPts;
    const width = Math.max(1, Math.round(height * ratio));
    const dpi = round(height / (pageSize.heightPts / 72), 2);
    targetWidthEl.value = width;
    targetDpiEl.value = dpi;
  };

  const updateFromDpi = () => {
    if (!pageSize) return;
    const dpi = Number(targetDpiEl.value);
    if (!Number.isFinite(dpi) || dpi <= 0) return;
    const width = Math.max(1, Math.round(dpi * (pageSize.widthPts / 72)));
    const height = Math.max(1, Math.round(dpi * (pageSize.heightPts / 72)));
    targetWidthEl.value = width;
    targetHeightEl.value = height;
    targetDpiEl.value = round(dpi, 2);
  };

  targetWidthEl.addEventListener('input', updateFromWidth);
  targetHeightEl.addEventListener('input', updateFromHeight);
  targetDpiEl.addEventListener('input', updateFromDpi);

  selectBtn.addEventListener('click', async () => {
    status.textContent = 'Select a PDF...';
    selectBtn.disabled = true;
    importBtn.disabled = true;
    helpBtn.hidden = true;

    try {
      const result = await window.electronAPI.pluginTrigger('addmedia', 'bulk-pdf-select', {
        slug,
        mdFile
      });

      if (!result || result === 1) {
        status.textContent = 'PDF selection failed (plugin not loaded). Restart the app.';
        helpBtn.hidden = true;
        return;
      }

      if (result?.success) {
        pdfPath = result.pdfPath || null;
        pageSize = result.page || null;
        fileNameEl.textContent = result.filename || 'Selected PDF';
        renderPageSize();
        setInputsEnabled(true);
        const nextFolder = await getNextFolderName();
        folderNameEl.value = nextFolder;
        if (pageSize && pageSize.heightPts > pageSize.widthPts) {
          targetHeightEl.value = 1920;
          updateFromHeight();
        } else {
          targetWidthEl.value = 1920;
          updateFromWidth();
        }
        status.textContent = 'Ready to import.';
        importBtn.disabled = false;
        return;
      }

      if (result?.canceled) {
        status.textContent = 'Selection canceled.';
        return;
      }

      if (result?.missingPoppler) {
        status.textContent = 'Poppler (pdfinfo) was not found. Install it to read page size.';
        helpBtn.hidden = false;
      } else {
        status.textContent = `Error: ${result?.error || 'PDF selection failed.'}`;
      }
      if (!result?.missingPoppler) {
        helpBtn.hidden = true;
      }
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      helpBtn.hidden = true;
    } finally {
      selectBtn.disabled = false;
    }
  });

  selectPptxBtn.addEventListener('click', async () => {
    status.textContent = 'Select a PPTX (optional)...';
    selectPptxBtn.disabled = true;

    try {
      const result = await window.electronAPI.pluginTrigger('addmedia', 'bulk-pptx-select', {
        slug,
        mdFile
      });

      if (!result || result === 1) {
        status.textContent = 'PPTX selection failed (plugin not loaded). Restart the app.';
        return;
      }

      if (result?.success) {
        pptxPath = result.pptxPath || null;
        pptxNameEl.textContent = result.filename || 'Selected PPTX';
        status.textContent = 'PPTX selected. Notes will be added during import.';
        return;
      }

      if (result?.canceled) {
        status.textContent = 'PPTX selection canceled.';
        return;
      }

      status.textContent = `Error: ${result?.error || 'PPTX selection failed.'}`;
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
    } finally {
      selectPptxBtn.disabled = false;
    }
  });

  importBtn.addEventListener('click', async () => {
    if (!pdfPath) {
      status.textContent = 'Select a PDF first.';
      return;
    }

    const dpi = Number(targetDpiEl.value);
    if (!Number.isFinite(dpi) || dpi <= 0) {
      status.textContent = 'Enter a valid DPI.';
      return;
    }

    const isValidFolder = await validateFolderName(folderNameEl.value);
    if (!isValidFolder) {
      status.textContent = 'Fix the folder name error above.';
      return;
    }

    status.textContent = 'Please wait while processing.';
    importBtn.disabled = true;
    selectBtn.disabled = true;
    selectPptxBtn.disabled = true;
    helpBtn.hidden = true;

    try {
      const result = await window.electronAPI.pluginTrigger('addmedia', 'bulk-import-pdf', {
        slug,
        mdFile,
        tagType,
        pdfPath,
        dpi,
        pptxPath,
        folderName: folderNameEl.value.trim()
      });

      if (result?.success) {
        localStorage.setItem(returnKey, JSON.stringify({ markdown: result.markdown || '' }));
        status.textContent = `Imported ${result.count || 0} pages at ${result.width || '?'}x${result.height || '?'} px.`;
        setTimeout(() => window.close(), 300);
        return;
      }

      if (result?.canceled) {
        localStorage.setItem(returnKey, JSON.stringify({ canceled: true }));
        status.textContent = 'Import canceled.';
        setTimeout(() => window.close(), 200);
        return;
      }

      status.textContent = `Error: ${result?.error || 'PDF import failed.'}`;
      helpBtn.hidden = !result?.missingPoppler;
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      helpBtn.hidden = true;
    } finally {
      importBtn.disabled = false;
      selectBtn.disabled = false;
      selectPptxBtn.disabled = false;
    }
  });
});
