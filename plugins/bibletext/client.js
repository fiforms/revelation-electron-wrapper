(function () {
  function t(key) {
    return typeof window.tr === 'function' ? window.tr(key) : key;
  }

  window.RevelationPlugins['bibletext'] = {
    name: 'bibletext',
    priority: 88,
    init(ctx) {
      this.context = ctx;
      if (ctx?.baseURL) {
        window.translationsources ||= [];
        window.translationsources.push(`${ctx.baseURL}/locales/translations.json`);
        if (typeof window.loadTranslations === 'function') {
          window.loadTranslations().catch((err) => {
            console.warn('[bibletext] failed to load plugin translations:', err);
          });
        }
      }
    },

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
          label: `📖 ${t('Add Bible Passage…')}`,
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
