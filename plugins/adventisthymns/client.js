(function () {
  window.RevelationPlugins['adventisthymns'] = {
    name: 'adventisthymns',
    priority: 82,
    init(ctx) {
      this.context = ctx;
    },

    getListMenuItems(pres) {
      return [
        {
          label: '🎵 Insert Hymn from Adventist Hymns…',
          action: async () => {
            // Ask Electron to open popup dialog
            if (window.electronAPI?.pluginTrigger) {
              await window.electronAPI.pluginTrigger('adventisthymns', 'openDialog');
            } else {
              // Fallback browser popup
              const url = `/plugins_${this.context.page.replace('list', this.context.page)}/adventisthymns/hymnsearch.html`;
              window.open(url, 'adventisthymns_search', 'width=600,height=500,resizable=yes,scrollbars=yes');
            }
          },
        },
      ];
    },
  };
})();
