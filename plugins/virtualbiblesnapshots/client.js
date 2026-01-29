// plugins/virtualbiblesnapshots/client.js
(function () {
  window.RevelationPlugins['virtualbiblesnapshots'] = {
    name: 'virtualbiblesnapshots',
    priority: 90,
    context: null,
    init(ctx) { this.context = ctx; },

    getMediaCreators(pres) {
      return [
        {
          label: '📷 VRBM Media Library…',
          action: ({ slug, mdFile, returnKey, insertTarget, tagType }) => {
            window.electronAPI.pluginTrigger('virtualbiblesnapshots', 'open-search', {
              slug: slug || pres.slug,
              mdFile: mdFile || pres.md,
              returnKey,
              insertTarget,
              tagType
            });
          }
        }
      ];
    },

    /*
    getListMenuItems(pres) {
      return [
        {
          label: '📷 Insert from VRBM Library…',
          action: () => window.electronAPI.pluginTrigger('virtualbiblesnapshots','open-search',{ slug: pres.slug, mdFile: pres.md })
        }
      ];
    }
    */
  };
})();
