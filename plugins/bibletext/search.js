document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');
  const mdFile = urlParams.get('md');
  const ref = document.getElementById('ref');
  const preview = document.getElementById('preview');
  const fetchBtn = document.getElementById('fetch');
  const insertBtn = document.getElementById('insert');
  const transSelect = document.getElementById('trans');

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
    await window.electronAPI.pluginTrigger('bibletext', 'insert-passage', {
      slug,
      mdFile,
      markdown: preview.value
    });
    alert('✅ Passage inserted.');
    window.close();
  };
});
