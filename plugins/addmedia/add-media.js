document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');
  const mdFile = urlParams.get('md') || 'presentation.md';

  const tagType = document.getElementById('tagType');
  const sortOrder = document.getElementById('sortOrder');
  const addMissingMedia = document.getElementById('addMissingMedia');
  const addSelectFile = document.getElementById('addSelectFile');
  const addSelectMedia = document.getElementById('addSelectMedia');

  addSelectFile.addEventListener('click', async () => {
    try {
      const result = await window.electronAPI.pluginTrigger('addmedia', 'add-selected-file', {
        slug,
        mdFile,
        tagType: tagType.value
      });

      if (result.success) {
        alert(`✅ Added ${result.filename}`);
        window.close();
      } else {
        alert(`❌ ${result.error}`);
      }
    } catch (err) {
      alert(`❌ Error: ${err.message}`);
    }
  });

  addSelectMedia.addEventListener('click', async () => {
    await window.electronAPI.pluginTrigger('addmedia', 'open-library-dialog', {
      slug, mdFile, tagType: tagType.value
    });
  });

  addMissingMedia.addEventListener('click', async () => {
    if (!slug) {
      alert('❌ Presentation slug not provided.');
      return;
    }

    const selectedTag = tagType.value;
    const selectedSort = sortOrder.value;

    addMissingMedia.disabled = true;
    addMissingMedia.textContent = '⏳ Processing...';

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
        addMissingMedia.disabled = false;
      }
    } catch (err) {
      console.error(err);
      alert(`❌ Error: ${err.message}`);
      addMissingMedia.disabled = false;
    }
  });
});
