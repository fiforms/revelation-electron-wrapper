import { pluginLoader } from '/js/pluginloader.js';

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');
  const mdFile = urlParams.get('md') || 'presentation.md';
  const key = urlParams.get('key') || urlParams.get('pluginKey') || null;

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
  const pluginMediaSection = document.getElementById('pluginMediaSection');
  const pluginMediaButtons = document.getElementById('pluginMediaButtons');

  const selectionKey = `addmedia:selected:${slug || 'unknown'}:${mdFile}`;
  let selectedItem = null;
  localStorage.removeItem(selectionKey);
  const returnKey = urlParams.get('returnKey');
  const insertTarget = urlParams.get('insertTarget');
  const origin = urlParams.get('origin');
  const defaultTagType = urlParams.get('tagType');
  if (defaultTagType) {
    tagType.value = defaultTagType;
  }
  if (origin === 'builder') {
    const sortOrderLabel = document.querySelector('label[for="sortOrder"]');
    if (sortOrderLabel) sortOrderLabel.style.display = 'none';
    sortOrder.style.display = 'none';
    if (addMissingMedia?.parentElement) addMissingMedia.parentElement.style.display = 'none';
  }

  function resolvePluginKey() {
    if (key) return key;
    if (!slug) return null;
    const match = slug.match(/^presentations_(.+)$/);
    return match ? match[1] : null;
  }

  async function loadMediaCreators() {
    if (!pluginMediaSection || !pluginMediaButtons) return;
    const pluginKey = resolvePluginKey();
    try {
      await pluginLoader('addmedia', pluginKey ? `/plugins_${pluginKey}` : '');
    } catch (err) {
      console.warn('Failed to load media creator plugins:', err);
    }

    const plugins = Object.entries(window.RevelationPlugins || {})
      .map(([name, plugin]) => ({ name, plugin, priority: plugin.priority ?? 100 }))
      .sort((a, b) => a.priority - b.priority);

    const creators = [];
    for (const { name, plugin } of plugins) {
      if (typeof plugin.getMediaCreators === 'function') {
        const items = plugin.getMediaCreators({ slug, md: mdFile, mdFile });
        if (Array.isArray(items)) {
          items.forEach((item) => {
            if (!item || typeof item.label !== 'string' || typeof item.action !== 'function') return;
            creators.push({ ...item, pluginName: name });
          });
        }
      }
    }

    if (!creators.length) return;
    pluginMediaButtons.innerHTML = '';
    creators.forEach((creator) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = creator.label;
      btn.addEventListener('click', () => {
        try {
          creator.action({
            slug,
            mdFile,
            origin,
            returnKey,
            insertTarget,
            tagType: tagType.value
          });
        } catch (err) {
          alert(`❌ ${err.message}`);
        }
      });
      pluginMediaButtons.appendChild(btn);
    });
    pluginMediaSection.style.display = 'block';
  }

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
        tagType: tagType.value,
        returnKey,
        insertTarget
      });

      if (result.success) {
        if (returnKey) {
          localStorage.setItem(returnKey, JSON.stringify({
            mode: 'file',
            filename: result.filename,
            encoded: result.encoded || encodeURIComponent(result.filename),
            tagType: tagType.value,
            insertTarget
          }));
          window.close();
        } else {
          alert(`✅ Added ${result.filename}`);
          window.close();
        }
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
      if (returnKey) {
        localStorage.setItem(returnKey, JSON.stringify({
          mode: 'media',
          item: selectedItem,
          tag,
          tagType: tagType.value,
          insertTarget
        }));
        localStorage.removeItem(selectionKey);
        window.close();
      } else {
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

  loadMediaCreators().catch((err) => {
    console.warn('Media creator load failed:', err);
  });
});
