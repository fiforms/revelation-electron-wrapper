(function () {
  window.RevelationPlugins['bibletext'] = {
    name: 'bibletext',
    priority: 88,
    init(ctx) { this.context = ctx; },

    /*
    getListMenuItems(pres) {
      return [
        {
          label: '📖 Insert Bible Passage…',
          action: () =>
            window.electronAPI.pluginTrigger('bibletext', 'open-bibletext-dialog', {
              slug: pres.slug,
              mdFile: pres.md
            })
        }
      ];
    },
    */
    getContentCreators(pres) {
      return [
        {
          label: '📖 Add Bible Passage…',
          action: ({ slug, mdFile, returnKey }) =>
            window.electronAPI.pluginTrigger('bibletext', 'open-bibletext-dialog', {
              slug: slug || pres.slug,
              mdFile: mdFile || pres.md,
              returnKey
            })
        }
      ];
    }
  };
})();
