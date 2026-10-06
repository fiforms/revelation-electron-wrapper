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
    },

    async getBuilderExtensions(ctx) {
      if (!isBuilderPage(this.context) || !ctx?.host) return [];
      try {
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
