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

    getContentCreators(pres) {
      return [
        {
          id: 'add-bible-passage',
          label: `📖 ${t('Add Bible Passage…')+'  (Ctrl+T)'}`,
          action: ({ slug, mdFile, returnKey }) =>
            window.electronAPI.pluginTrigger('bibletext', 'open-bibletext-dialog', {
              slug: slug || pres.slug,
              mdFile: mdFile || pres.md,
              returnKey
            })
        }
      ];
    },

    getBuilderExtensions({ host }) {
      host.registerKeyboardShortcut({
        key: 't',
        ctrl: true,
        onTrigger() {
          host.triggerContentCreator('bibletext', 'add-bible-passage');
        }
      });
      return [];
    }
  };
})();
