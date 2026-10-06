// plugins/virtualbiblesnapshots/client.js (browser side)
//
// Registers a getMediaCreators entry ("Virtual Bible Snapshots") that the
// builder / Add Media UI shows; its action calls IPC plugin-trigger
// 'virtualbiblesnapshots' 'open-search' (see plugin.js). Also registers the
// plugin's locales/translations.json with window.translationsources.

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
