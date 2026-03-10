(function () {
  function t(key) {
    return typeof window.tr === 'function' ? window.tr(key) : key;
  }

  window.RevelationPlugins.wordpress_publish = {
    name: 'wordpress_publish',
    context: null,

    init(context) {
      this.context = context;
      if (context?.baseURL) {
        window.translationsources ||= [];
        window.translationsources.push(`${context.baseURL}/locales/translations.json`);
        if (typeof window.loadTranslations === 'function') {
          window.loadTranslations().catch((err) => {
            console.warn('[wordpress_publish] failed to load plugin translations:', err);
          });
        }
      }
    },

    getListMenuItems(presentation) {
      if (!window.electronAPI?.pluginTrigger) return [];
      const slug = presentation?.slug || '';
      const md = presentation?.md || 'presentation.md';
      return [
        {
          label: '🚀 ' + t('WordPress Publish...'),
          action: async () => {
            try {
              await window.electronAPI.pluginTrigger('wordpress_publish', 'open-pairing-window', {
                slug,
                mdFile: md,
                title: presentation?.title || ''
              });
            } catch (err) {
              window.alert(`${t('Pairing window failed to open:')} ${err.message}`);
            }
          }
        }
      ];
    }
  };
})();
