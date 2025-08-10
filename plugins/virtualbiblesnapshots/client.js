// plugins/virtualbiblesnapshots/client.js
(function () {
  window.RevelationPlugins['virtualbiblesnapshots'] = {
    name: 'virtualbiblesnapshots',
    priority: 90,
    context: null,
    init(ctx) { this.context = ctx; },

    getListMenuItems(pres) {
      return [
        {
          label: '📷 Insert from VRBM Library…',
          action: () => window.electronAPI.pluginTrigger('virtualbiblesnapshots','open-search',{ slug: pres.slug, mdFile: pres.md })
        }
      ];
    }
  };
})();
