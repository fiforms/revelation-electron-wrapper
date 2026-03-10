(function () {
  window.RevelationPlugins.wordpress_publish = {
    name: 'wordpress_publish',
    context: null,

    init(context) {
      this.context = context;
    },

    getListMenuItems(presentation) {
      if (!window.electronAPI?.pluginTrigger) return [];
      const slug = presentation?.slug || '';
      const md = presentation?.md || 'presentation.md';
      return [
        {
          label: 'WordPress Publish: Pair Site…',
          action: async () => {
            try {
              await window.electronAPI.pluginTrigger('wordpress_publish', 'open-pairing-window', {
                slug,
                mdFile: md,
                title: presentation?.title || ''
              });
            } catch (err) {
              window.alert(`Pairing window failed to open: ${err.message}`);
            }
          }
        }
      ];
    }
  };
})();
