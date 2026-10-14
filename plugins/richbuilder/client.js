// plugins/richbuilder/client.js
//
// Browser-side hook. On the Presentation Builder page only (context.page ===
// 'builder') it lazy-imports ./builder.js and returns its
// getBuilderExtensions(ctx) (a "Rich" preview mode button + editor surface).
// Same loader pattern as plugins/slidesorter, mdvalidate and test.

(function () {
  function isBuilderPage(context) {
    return String(context?.page || '').trim().toLowerCase() === 'builder';
  }

  window.RevelationPlugins = window.RevelationPlugins || {};
  window.RevelationPlugins.richbuilder = {
    name: 'richbuilder',
    context: null,

    init(context) {
      this.context = context;
      // Register the plugin's Spanish catalog; the toolbar HTML is built once,
      // so getBuilderExtensions awaits this before importing builder.js.
      this.translationsReady = Promise.resolve();
      if (context?.baseURL) {
        window.translationsources ||= [];
        window.translationsources.push(`${context.baseURL}/locales/translations.json`);
        if (typeof window.loadTranslations === 'function') {
          this.translationsReady = Promise.resolve(window.loadTranslations()).catch((err) => {
            console.warn('[richbuilder plugin] failed to load plugin translations:', err);
          });
        }
      }
    },

    async getBuilderExtensions(ctx) {
      if (!isBuilderPage(this.context) || !ctx?.host) return [];
      try {
        await this.translationsReady;
        const mod = await import('./builder.js');
        return typeof mod.getBuilderExtensions === 'function'
          ? mod.getBuilderExtensions(ctx)
          : [];
      } catch (err) {
        console.error('[richbuilder plugin] Failed to load builder module:', err);
        return [];
      }
    }
  };
})();
