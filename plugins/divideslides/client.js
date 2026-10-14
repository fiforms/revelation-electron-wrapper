// plugins/divideslides/client.js
// Registers the "Divide Slides" Content menu entry: splits long slides
// (song verses, pasted paragraphs) into multiple slides by line/word count.

(function () {
  function isBuilderPage(context) {
    return String(context?.page || '').trim().toLowerCase() === 'builder';
  }

  function tr(key) {
    return typeof window.tr === 'function' ? window.tr(key) : key;
  }

  window.RevelationPlugins.divideslides = {
    name: 'divideslides',
    context: null,

    init(context) {
      this.context = context;
      // Register the plugin's Spanish catalog (builder page only).
      if (isBuilderPage(context) && context?.baseURL) {
        window.translationsources ||= [];
        window.translationsources.push(`${context.baseURL}/locales/translations.json`);
        if (typeof window.loadTranslations === 'function') {
          Promise.resolve(window.loadTranslations()).catch((err) => {
            console.warn('[divideslides] failed to load plugin translations:', err);
          });
        }
      }
    },

    // Smart Paste split hook (http_admin/builder/smart-paste.js): resolves with
    // the divided markdown, or null when the user cancels.
    async onBuilderSmartPasteSplit(markdown) {
      const mod = await import('./builder.js');
      return mod.openDivideForPaste(markdown);
    },

    getBuilderTemplates() {
      if (!isBuilderPage(this.context)) return [];
      return [
        {
          label: `✂️ ${tr('Divide Slides')}`,
          onSelect: async () => {
            try {
              // Lazy-load builder-only code so presentation sessions skip parsing it.
              const mod = await import('./builder.js');
              return await mod.openDivideDialog();
            } catch (err) {
              console.error('[divideslides plugin] Failed to load divide dialog:', err);
              return { canceled: true };
            }
          }
        }
      ];
    }
  };
})();
