(function () {
  window.RevelationPlugins['adventisthymns'] = {
    name: 'adventisthymns',
    priority: 82,
    init(ctx) {
      this.context = ctx;
    },

    /*
    getListMenuItems(pres) {
      return [
        {
          label: '🎵 Insert Hymn from Adventist Hymns…',
          action: async () => {
            // Ask Electron to open popup dialog, passing current presentation slug and markdown file
            await window.electronAPI.pluginTrigger('adventisthymns', 'openDialog', {slug: pres.slug, mdFile: pres.md});
          },
        },
      ];
    },
    */

    getContentCreators(pres) {
      return [
        {
          label: '🎵 Add Hymn from Adventist Hymns…',
          action: async ({ slug, mdFile, returnKey }) => {
            await window.electronAPI.pluginTrigger('adventisthymns', 'openDialog', {
              slug: slug || pres.slug,
              mdFile: mdFile || pres.md,
              returnKey
            });
          }
        }
      ];
    },
  };
})();
