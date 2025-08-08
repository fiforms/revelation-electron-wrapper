document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');
  const mdFile = urlParams.get('md') || 'presentation.md';

  const tagType = document.getElementById('tagType');
  const sortOrder = document.getElementById('sortOrder');
  const runButton = document.getElementById('runButton');

  runButton.addEventListener('click', async () => {
    if (!slug) {
      alert('❌ Presentation slug not provided.');
      return;
    }

    const selectedTag = tagType.value;
    const selectedSort = sortOrder.value;

    runButton.disabled = true;
    runButton.textContent = '⏳ Processing...';

    try {
      const result = await window.electronAPI.pluginTrigger(
        'addmedia',
        'process-missing-media',
        {
          slug,
          mdFile,
          tagType: selectedTag,
          sortOrder: selectedSort
        }
      );

      if (result?.success) {
        alert(`✅ Added ${result.count} new slides.`);
        window.close(); // or go back
      } else {
        alert(`⚠️ ${result?.error || 'Something went wrong.'}`);
        runButton.disabled = false;
        runButton.textContent = '➕ Add Missing Media';
      }
    } catch (err) {
      console.error(err);
      alert(`❌ Error: ${err.message}`);
      runButton.disabled = false;
      runButton.textContent = '➕ Add Missing Media';
    }
  });
});
