document.addEventListener('DOMContentLoaded', async () => {
  const status = document.getElementById('status');
  const closeBtn = document.getElementById('closeBtn');
  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');
  const mdFile = urlParams.get('md');
  const returnKey = urlParams.get('returnKey');
  const tagType = urlParams.get('tagType') || 'normal';

  closeBtn.addEventListener('click', () => window.close());

  if (!window.electronAPI?.pluginTrigger) {
    status.textContent = 'This action is only available in the desktop app.';
    return;
  }
  if (!slug || !returnKey) {
    status.textContent = 'Missing presentation info.';
    return;
  }

  status.textContent = 'Choose images to import...';

  try {
    const result = await window.electronAPI.pluginTrigger('addmedia', 'bulk-add-images', {
      slug,
      mdFile,
      tagType
    });

    if (result?.success) {
      localStorage.setItem(returnKey, JSON.stringify({ markdown: result.markdown || '' }));
      status.textContent = `Imported ${result.count || 0} images.`;
      setTimeout(() => window.close(), 300);
      return;
    }

    if (result?.canceled) {
      localStorage.setItem(returnKey, JSON.stringify({ canceled: true }));
      status.textContent = 'Import canceled.';
      setTimeout(() => window.close(), 200);
      return;
    }

    status.textContent = `Error: ${result?.error || 'Image import failed.'}`;
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
});
