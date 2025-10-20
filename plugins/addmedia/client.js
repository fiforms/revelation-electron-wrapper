(function () {
  window.RevelationPlugins['add-media'] = {
    name: 'add-media',
    context: null,

    init(context) {
      this.context = context;
    },

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
    },
    getMediaMenuItems(mediaItem) {
      return [
        {
          label: 'Add Media to Selected Presentation',
          action: () => alert(`Not Yet Implemented: ${mediaItem.filename}`) // FIXME: Placeholder action
        }
      ];
    }
  };
})();
