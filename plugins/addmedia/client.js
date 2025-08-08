(function () {
  window.RevelationPlugins['add-missing-media'] = {
    name: 'add-missing-media',
    context: null,

    init(context) {
      this.context = context;
    },

    getListMenuItems(presentation) {
      return [
        {
          label: '🖼️ Add Missing Media',
          action: () => {
            window.electronAPI.pluginTrigger('addmedia', 'add-missing-media', {
              slug: presentation.slug,
              mdFile: presentation.md
            });
          }
        }
      ];
    }
  };
})();
