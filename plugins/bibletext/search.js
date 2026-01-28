document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  let slug = urlParams.get('slug');
  let mdFile = urlParams.get('md');
  const returnKey = urlParams.get('returnKey');
  const ref = document.getElementById('ref');
  const preview = document.getElementById('preview');
  const fetchBtn = document.getElementById('fetch');
  const insertBtn = document.getElementById('insert');
  const transSelect = document.getElementById('trans');

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
      insertBtn.innerHTML = 'Cannot Insert (No Presentation)';
    }
  } else {
    insertBtn.disabled = false;
  }

  // 🔹 Fetch translation list
  const res = await window.electronAPI.pluginTrigger('bibletext', 'get-translations');
  if (res.success && Array.isArray(res.translations)) {
    transSelect.innerHTML = res.translations
      .map(t => `<option value="${t.id}">${t.name}</option>`)
      .join('');
  } else {
    transSelect.innerHTML = `<option value="KJV">King James Version (English)</option>`;
  }

  // 🔹 Default to first option
  if (transSelect.options.length > 0) transSelect.selectedIndex = 0;

  fetchBtn.onclick = async () => {
    preview.value = 'Loading...';
    const result = await window.electronAPI.pluginTrigger('bibletext', 'fetch-passage', {
      osis: ref.value,
      translation: transSelect.value
    });
    if (result.success) preview.value = result.markdown;
    else preview.value = '❌ Error: ' + result.error;
  };

  insertBtn.onclick = async () => {
    if (!preview.value.trim()) {
      alert('Fetch text first.');
      return;
    }
    if (returnKey) {
      localStorage.setItem(returnKey, JSON.stringify({ markdown: preview.value }));
      window.close();
      return;
    }
    await window.electronAPI.pluginTrigger('bibletext', 'insert-passage', {
      slug,
      mdFile,
      markdown: preview.value
    });
    alert('✅ Passage inserted.');
    window.close();
  };
});
