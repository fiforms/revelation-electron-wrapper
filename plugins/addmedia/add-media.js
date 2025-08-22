document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');
  const mdFile = urlParams.get('md') || 'presentation.md';

  const tagType = document.getElementById('tagType');
  const sortOrder = document.getElementById('sortOrder');
  const addMissingMedia = document.getElementById('addMissingMedia');
  const addSelectFile = document.getElementById('addSelectFile');
  const addSelectMedia = document.getElementById('addSelectMedia');

  // FIXME: Add event listeners for the new buttons
  addSelectFile.addEventListener('click', () => {
    alert('This feature is not yet implemented. Please select a file from your system.');
  }); 

  addSelectMedia.addEventListener('click', () => {
    alert('This feature is not yet implemented. Please select media from the library.');
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
