document.addEventListener('DOMContentLoaded', () => {
  const status = document.getElementById('status');
  const closeBtn = document.getElementById('closeBtn');
  const importBtn = document.getElementById('importBtn');
  const helpBtn = document.getElementById('helpBtn');
  const presetEl = document.getElementById('preset');

  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');
  const mdFile = urlParams.get('md');
  const returnKey = urlParams.get('returnKey');
  const tagType = urlParams.get('tagType') || 'normal';

  closeBtn.addEventListener('click', () => window.close());
  helpBtn.addEventListener('click', () => {
    const url = 'https://github.com/fiforms/revelation-electron-wrapper/blob/main/README-PDF.md';
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
    importBtn.disabled = true;
    return;
  }

  importBtn.addEventListener('click', async () => {
    status.textContent = 'Please wait while processing.';
    importBtn.disabled = true;

    try {
      const result = await window.electronAPI.pluginTrigger('addmedia', 'bulk-import-pdf', {
        slug,
        mdFile,
        tagType,
        preset: presetEl.value
      });

      if (result?.success) {
        helpBtn.hidden = true;
        localStorage.setItem(returnKey, JSON.stringify({ markdown: result.markdown || '' }));
        status.textContent = `Imported ${result.count || 0} pages at ${result.width || '?'}x${result.height || '?'} px.`;
        setTimeout(() => window.close(), 300);
        return;
      }

      if (result?.canceled) {
        helpBtn.hidden = true;
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
    }
  });
});
