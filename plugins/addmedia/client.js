(function () {
  const DROPPABLE_MEDIA_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg',
    'mp4', 'webm', 'm4v', 'ogv',
    'mp3', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'flac'
  ]);
  const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'flac']);
  const DND_DEBUG = false;

  function logDnd(...args) {
    if (!DND_DEBUG) return;
    console.log('[addmedia:dnd]', ...args);
  }

  function isBuilderPage(context) {
    return String(context?.page || '').trim().toLowerCase() === 'builder';
  }

  function isFileDrag(event) {
    const types = event?.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes('Files');
  }

  function getBuilderLocationInfo() {
    const query = new URLSearchParams(window.location.search);
    return {
      slug: query.get('slug') || '',
      mdFile: query.get('md') || 'presentation.md'
    };
  }

  function getFilePath(file) {
    if (window.electronAPI?.getPathForFile) {
      try { return window.electronAPI.getPathForFile(file) || ''; } catch (_e) { /* fall through */ }
    }
    return typeof file?.path === 'string' ? file.path : '';
  }

  function extractDroppedImagePaths(event) {
    const dt = event?.dataTransfer;
    logDnd('drop payload types:', Array.from(dt?.types || []));
    const files = Array.from(dt?.files || []);
    logDnd('dataTransfer.files:', files.map((file) => ({
      name: file?.name || '',
      type: file?.type || '',
      size: file?.size || 0,
      path: getFilePath(file)
    })));
    logDnd('dataTransfer.items:', Array.from(dt?.items || []).map((item) => ({
      kind: item?.kind || '',
      type: item?.type || ''
    })));
    const itemPaths = Array.from(dt?.items || [])
      .map((item) => (typeof item.getAsFile === 'function' ? item.getAsFile() : null))
      .filter(Boolean);
    const combined = [...files, ...itemPaths];
    const uniqueByName = new Map();
    combined.forEach((file) => {
      const key = `${String(file?.name || '')}:${String(file?.size || 0)}`;
      if (!uniqueByName.has(key)) uniqueByName.set(key, file);
    });
    const allMedia = Array.from(uniqueByName.values())
      .map((file) => {
        const name = String(file?.name || '');
        const ext = name.split('.').pop()?.toLowerCase() || '';
        return {
          file,
          name,
          ext,
          path: getFilePath(file),
          isAudio: AUDIO_EXTENSIONS.has(ext)
        };
      })
      .filter((item) => DROPPABLE_MEDIA_EXTENSIONS.has(item.ext));

    const images = allMedia.filter((item) => !item.isAudio);
    const audio = allMedia.filter((item) => item.isAudio);

    const imagePaths = images.filter((item) => item.path).map((item) => item.path);
    const imageUploads = images.filter((item) => !item.path).map((item) => item.file);
    const audioPaths = audio.filter((item) => item.path).map((item) => item.path);
    const audioUploads = audio.filter((item) => !item.path).map((item) => item.file);

    logDnd('extracted image paths:', imagePaths);
    logDnd('image files without paths:', imageUploads.map((f) => ({ name: f?.name || '', size: f?.size || 0 })));
    logDnd('extracted audio paths:', audioPaths);
    logDnd('audio files without paths:', audioUploads.map((f) => ({ name: f?.name || '', size: f?.size || 0 })));

    return { imagePaths, imageUploads, audioPaths, audioUploads };
  }

  async function fileToBase64(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  async function buildUploadPayload(files) {
    const uploads = [];
    for (const file of files || []) {
      if (!file || typeof file.arrayBuffer !== 'function') continue;
      try {
        const dataBase64 = await fileToBase64(file);
        uploads.push({
          name: String(file.name || 'image'),
          dataBase64
        });
      } catch (err) {
        logDnd('failed to encode dropped file:', file?.name, err?.message || err);
      }
    }
    return uploads;
  }

  function buildSlideBody(tagType, encodedPath) {
    if (!encodedPath) return '';
    if (tagType === 'background') return `![background](${encodedPath})`;
    if (tagType === 'backgroundnoloop') return `![background:noloop](${encodedPath})`;
    if (tagType === 'fit') return `![fit](${encodedPath})`;
    return `![](${encodedPath})`;
  }

  function buildAudioSlideBody(audioPath) {
    if (!audioPath) return '';
    return `:audio:play:${audioPath}:`;
  }

  function removeAudioLines(body) {
    return (body || '').split('\n').filter((line) => !line.trim().startsWith(':audio:')).join('\n');
  }

  function insertDroppedMediaAsSlides(audioImported, imageImported, tagType) {
    const host = window.RevelationBuilderHost;
    if (!host || typeof host.transact !== 'function' || typeof host.getSelection !== 'function' || typeof host.getDocument !== 'function') {
      return false;
    }

    const audioSlides = (Array.isArray(audioImported) ? audioImported : [])
      .map((item) => {
        const audioPath = item?.encoded || item?.relPath || '';
        return { body: buildAudioSlideBody(audioPath) };
      })
      .filter((slide) => slide.body);

    const imageSlides = (Array.isArray(imageImported) ? imageImported : [])
      .map((item) => ({
        body: buildSlideBody(tagType, item?.encoded || '')
      }))
      .filter((slide) => slide.body);

    const merged = [...audioSlides];
    if (imageSlides.length > 0) {
      if (merged.length > 0) {
        merged[merged.length - 1].body += '\n' + imageSlides[0].body;
        merged.push(...imageSlides.slice(1));
      } else {
        merged.push(...imageSlides);
      }
    }

    if (!merged.length) return false;

    const sel = host.getSelection() || { h: 0, v: 0 };
    const doc = host.getDocument();
    const currentSlide = doc?.stacks?.[sel.h]?.[sel.v];

    const goesToCurrentSlide = audioSlides.length > 0 || !currentSlide?.body?.trim();

    let slidesToInsert = [];
    host.transact('addmedia:drop-media', (tx) => {
      if (goesToCurrentSlide) {
        let newBody = removeAudioLines(currentSlide?.body || '').trim();
        if (newBody) newBody += '\n';
        newBody += merged[0].body;

        const col = (doc.stacks[sel.h] || []).slice();
        col[sel.v] = { ...(col[sel.v] || {}), body: newBody.trim() };
        tx.replaceColumn(sel.h, col);

        slidesToInsert = merged.slice(1);
      } else {
        slidesToInsert = merged;
      }

      if (slidesToInsert.length > 0) {
        tx.insertSlides(sel, slidesToInsert);
      }
    });

    return true;
  }

  window.RevelationPlugins.addmedia = {
    name: 'addmedia',
    context: null,
    priority: 94,
    builderDropHookReady: false,
    dragOverlayEl: null,
    dragDepth: 0,

    init(context) {
      this.context = context;
      if (!isBuilderPage(context) || this.builderDropHookReady) return;
      if (!window.electronAPI?.pluginTrigger) return;

      const ensureDragOverlay = () => {
        if (this.dragOverlayEl) return this.dragOverlayEl;
        const overlay = document.createElement('div');
        overlay.style.cssText = [
          'position: fixed',
          'inset: 0',
          'z-index: 30000',
          'display: none',
          'align-items: center',
          'justify-content: center',
          'pointer-events: none',
          'background: rgba(8, 18, 38, 0.35)',
          'backdrop-filter: blur(1px)'
        ].join(';');
        const card = document.createElement('div');
        card.style.cssText = [
          'padding: 18px 24px',
          'border: 2px dashed rgba(255, 255, 255, 0.9)',
          'border-radius: 12px',
          'color: #ffffff',
          'font: 600 18px/1.3 system-ui, sans-serif',
          'background: rgba(12, 19, 33, 0.7)',
          'box-shadow: 0 10px 28px rgba(0, 0, 0, 0.25)'
        ].join(';');
        card.textContent = 'Drop images, videos, or audio files';
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        this.dragOverlayEl = overlay;
        return overlay;
      };

      const showDragOverlay = () => {
        const overlay = ensureDragOverlay();
        overlay.style.display = 'flex';
      };

      const hideDragOverlay = () => {
        this.dragDepth = 0;
        if (!this.dragOverlayEl) return;
        this.dragOverlayEl.style.display = 'none';
      };

      const handleDragOver = (event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        logDnd('dragover detected');
        showDragOverlay();
      };

      const handleDragEnter = (event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        this.dragDepth += 1;
        logDnd('dragenter depth=', this.dragDepth);
        showDragOverlay();
      };

      const handleDragLeave = (event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        this.dragDepth = Math.max(this.dragDepth - 1, 0);
        logDnd('dragleave depth=', this.dragDepth);
        if (this.dragDepth === 0) {
          hideDragOverlay();
        }
      };

      const handleDrop = async (event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        logDnd('drop received');
        hideDragOverlay();
        const dropped = extractDroppedImagePaths(event);
        const imagePaths = dropped.imagePaths || [];
        const imageUploads = await buildUploadPayload(dropped.imageUploads || []);
        const audioPaths = dropped.audioPaths || [];
        const audioUploads = await buildUploadPayload(dropped.audioUploads || []);

        if (!imagePaths.length && !imageUploads.length && !audioPaths.length && !audioUploads.length) {
          logDnd('no valid media paths detected');
          window.alert('No image/video/audio files were detected in the drop payload.');
          return;
        }

        const doc = getBuilderLocationInfo();
        let audioResult = null;
        let imageResult = null;
        try {
          // Process audio first
          if (audioPaths.length || audioUploads.length) {
            logDnd('importing dropped audio paths:', audioPaths);
            logDnd('importing dropped audio uploads:', audioUploads.map((item) => ({
              name: item.name,
              bytesBase64Length: item.dataBase64.length
            })));
            audioResult = await window.electronAPI.pluginTrigger('addmedia', 'bulk-add-audio-from-drop', {
              slug: doc.slug,
              mdFile: doc.mdFile,
              filePaths: audioPaths,
              uploads: audioUploads
            });
            logDnd('audio plugin result:', audioResult);
            if (!audioResult?.success) {
              window.alert(`❌ ${audioResult?.error || 'Audio import failed.'}`);
              return;
            }
          }

          // Then process images
          if (imagePaths.length || imageUploads.length) {
            logDnd('importing dropped image paths:', imagePaths);
            logDnd('importing dropped image uploads:', imageUploads.map((item) => ({
              name: item.name,
              bytesBase64Length: item.dataBase64.length
            })));
            imageResult = await window.electronAPI.pluginTrigger('addmedia', 'bulk-add-images-from-drop', {
              slug: doc.slug,
              mdFile: doc.mdFile,
              tagType: 'fit',
              filePaths: imagePaths,
              uploads: imageUploads
            });
            logDnd('image plugin result:', imageResult);
            if (!imageResult?.success) {
              window.alert(`❌ ${imageResult?.error || 'Image import failed.'}`);
              return;
            }
          }

          const audioImported = audioResult?.imported || [];
          const imageImported = imageResult?.imported || [];
          const inserted = insertDroppedMediaAsSlides(audioImported, imageImported, 'fit');
          logDnd('media slide insertion result:', inserted);
          if (!inserted) {
            window.alert('Media files were imported, but slide insertion is unavailable in this view.');
            return;
          }

          const totalCount = (audioResult?.count || 0) + (imageResult?.count || 0);
          if (window.RevelationBuilderHost?.notify) {
            window.RevelationBuilderHost.notify(`Imported ${totalCount} media slide(s).`);
          }
        } catch (err) {
          window.alert(`❌ ${err.message}`);
        }
      };

      const target = window;
      target.addEventListener('dragenter', handleDragEnter, true);
      target.addEventListener('dragover', handleDragOver, true);
      target.addEventListener('dragleave', handleDragLeave, true);
      target.addEventListener('drop', handleDrop, true);
      this.builderDropHookReady = true;
    },

    getContentCreators(pres) {
      return [
        {
          label: '🖼️ Bulk Add Images…',
          action: async ({ slug, mdFile, returnKey }) => {
            if (!window.electronAPI?.pluginTrigger) {
              alert('Add Content is only available in the desktop app.');
              return;
            }
            try {
              const result = await window.electronAPI.pluginTrigger('addmedia', 'open-bulk-image-dialog', {
                slug: slug || pres.slug,
                mdFile: mdFile || pres.md,
                returnKey,
                tagType: 'normal'
              });
              if (result?.success === false && !result?.canceled) {
                alert(`❌ ${result?.error || 'Image import failed.'}`);
              }
            } catch (err) {
              alert(`❌ ${err.message}`);
            }
          }
        },
        {
          label: '🖼️ Bulk Add Background Images…',
          action: async ({ slug, mdFile, returnKey }) => {
            if (!window.electronAPI?.pluginTrigger) {
              alert('Add Content is only available in the desktop app.');
              return;
            }
            try {
              const result = await window.electronAPI.pluginTrigger('addmedia', 'open-bulk-image-dialog', {
                slug: slug || pres.slug,
                mdFile: mdFile || pres.md,
                returnKey,
                tagType: 'background'
              });
              if (result?.success === false && !result?.canceled) {
                alert(`❌ ${result?.error || 'Image import failed.'}`);
              }
            } catch (err) {
              alert(`❌ ${err.message}`);
            }
          }
        },
        {
          label: '🖼️ Bulk Add Fit Images…',
          action: async ({ slug, mdFile, returnKey }) => {
            if (!window.electronAPI?.pluginTrigger) {
              alert('Add Content is only available in the desktop app.');
              return;
            }
            try {
              const result = await window.electronAPI.pluginTrigger('addmedia', 'open-bulk-image-dialog', {
                slug: slug || pres.slug,
                mdFile: mdFile || pres.md,
                returnKey,
                tagType: 'fit'
              });
              if (result?.success === false && !result?.canceled) {
                alert(`❌ ${result?.error || 'Image import failed.'}`);
              }
            } catch (err) {
              alert(`❌ ${err.message}`);
            }
          }
        },
        {
          label: '📄 Import PDF/PPTX…',
          action: async ({ slug, mdFile, returnKey }) => {
            if (!window.electronAPI?.pluginTrigger) {
              alert('Add Content is only available in the desktop app.');
              return;
            }
            try {
              const result = await window.electronAPI.pluginTrigger('addmedia', 'open-bulk-pdf-dialog', {
                slug: slug || pres.slug,
                mdFile: mdFile || pres.md,
                returnKey,
                tagType: 'normal'
              });
              if (result?.success === false && !result?.canceled) {
                alert(`❌ ${result?.error || 'PDF import failed.'}`);
              }
            } catch (err) {
              alert(`❌ ${err.message}`);
            }
          }
        }
      ];
    },

    /*
    getListMenuItems(presentation) {
      return [
        {
          label: '🖼️ Add Media',
          action: () => {
            window.electronAPI.pluginTrigger('addmedia', 'addmedia', {
              slug: presentation.slug,
              mdFile: presentation.md
            });
          }
        }
      ];
    }
    */
  };
})();
