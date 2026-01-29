(function () {
  window.RevelationPlugins['add-media'] = {
    name: 'add-media',
    context: null,
    priority: 94,

    init(context) {
      this.context = context;
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
        }
      ];
    },

    /*
    getListMenuItems(presentation) {
      return [
        {
          label: '🖼️ Add Media',
          action: () => {
            window.electronAPI.pluginTrigger('addmedia', 'add-media', {
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
