// plugins/virtualbiblesnapshots/client.js
(function () {
  function t(key) {
    return typeof window.tr === 'function' ? window.tr(key) : key;
  }

  window.RevelationPlugins['virtualbiblesnapshots'] = {
    name: 'virtualbiblesnapshots',
    priority: 90,
    context: null,
    init(ctx) {
      this.context = ctx;
      if (ctx?.baseURL) {
        window.translationsources ||= [];
        window.translationsources.push(`${ctx.baseURL}/locales/translations.json`);
        if (typeof window.loadTranslations === 'function') {
          window.loadTranslations().catch((err) => {
            console.warn('[virtualbiblesnapshots] failed to load plugin translations:', err);
          });
        }
      }
    },

    getMediaCreators(pres) {
      return [
        {
          label: t('📷 Virtual Bible Snapshots'),
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

  };
})();
