document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');
  const mdFile = urlParams.get('md') || 'presentation.md';

  const tagType = document.getElementById('tagType');
  const sortOrder = document.getElementById('sortOrder');
  const addMissingMedia = document.getElementById('addMissingMedia');
  const addSelectFile = document.getElementById('addSelectFile');
  const addSelectMedia = document.getElementById('addSelectMedia');
  const selectedMediaPanel = document.getElementById('selectedMediaPanel');
  const selectedMediaName = document.getElementById('selectedMediaName');
  const mediaTagInput = document.getElementById('mediaTag');
  const mediaTagError = document.getElementById('mediaTagError');
  const insertSelectedMedia = document.getElementById('insertSelectedMedia');

  const selectionKey = `addmedia:selected:${slug || 'unknown'}:${mdFile}`;
  let selectedItem = null;
  localStorage.removeItem(selectionKey);

  const sanitizeTag = (value) => value.toLowerCase().replace(/[^a-z0-9_]/g, '');

  const generateDefaultTag = (meta) => {
    const baseTag = (meta.original_filename || 'media')
      .split(/\W+/)[0]
      .slice(0, 7)
      || 'media';

    const found = (meta.filename.match(/\d/g) || []).slice(0, 4);
    while (found.length < 4) found.push(String(Math.floor(Math.random() * 10)));
    const digits = found.join('');
    return sanitizeTag(`${baseTag}${digits}`) || 'media';
  };

  const showTagError = (message) => {
    mediaTagError.textContent = message || '';
  };

  const updateSelectedMediaUI = (payload) => {
    if (!payload?.item) return;
    selectedItem = payload.item;
    const displayName = payload.item.original_filename || payload.item.filename || 'Selected media';
    selectedMediaName.textContent = `Selected: ${displayName}`;
    mediaTagInput.value = generateDefaultTag(payload.item);
    selectedMediaPanel.style.display = 'block';
    showTagError('');
  };

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
    localStorage.removeItem(selectionKey);
    await window.electronAPI.pluginTrigger('addmedia', 'open-library-dialog', {
      slug, mdFile, tagType: tagType.value
    });
  });

  mediaTagInput.addEventListener('input', () => {
    const sanitized = sanitizeTag(mediaTagInput.value);
    if (mediaTagInput.value !== sanitized) {
      mediaTagInput.value = sanitized;
    }
    if (!mediaTagInput.value) {
      showTagError('Tag is required.');
    } else if (!/^[a-z0-9_]+$/.test(mediaTagInput.value)) {
      showTagError('Only lowercase letters, numbers, and _ are allowed.');
    } else {
      showTagError('');
    }
  });

  insertSelectedMedia.addEventListener('click', async () => {
    if (!selectedItem) {
      showTagError('Select a media item first.');
      return;
    }
    const tag = sanitizeTag(mediaTagInput.value);
    if (!tag || !/^[a-z0-9_]+$/.test(tag)) {
      showTagError('Only lowercase letters, numbers, and _ are allowed.');
      return;
    }

    insertSelectedMedia.disabled = true;
    insertSelectedMedia.textContent = '⏳ Inserting...';

    try {
      const result = await window.electronAPI.pluginTrigger('addmedia', 'insert-selected-media', {
        slug,
        mdFile,
        tagType: tagType.value,
        item: selectedItem,
        tag
      });

      if (result?.success) {
        alert(`✅ Inserted Media`);
        localStorage.removeItem(selectionKey);
        window.close();
      } else {
        showTagError(result?.error || 'Something went wrong.');
      }
    } catch (err) {
      console.error(err);
      showTagError(`Error: ${err.message}`);
    } finally {
      insertSelectedMedia.disabled = false;
      insertSelectedMedia.textContent = '✅ Insert Selected Media';
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== selectionKey || !event.newValue) return;
    try {
      const payload = JSON.parse(event.newValue);
      updateSelectedMediaUI(payload);
    } catch (err) {
      console.warn('Invalid media selection payload', err);
    }
  });

  const existingSelection = localStorage.getItem(selectionKey);
  if (existingSelection) {
    try {
      updateSelectedMediaUI(JSON.parse(existingSelection));
    } catch (err) {
      console.warn('Invalid stored media selection', err);
    }
  }

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
