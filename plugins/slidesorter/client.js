// plugins/slidesorter/client.js
//
// Browser-side hook. On the Presentation Builder page only, lazy-imports
// ./builder.js and returns its getBuilderExtensions(ctx). Same loader pattern
// as richbuilder, mdvalidate and test; the four copies differ only in names.

(function () {
  function isBuilderPage(context) {
    return String(context?.page || '').trim().toLowerCase() === 'builder';
  }

  window.RevelationPlugins.slidesorter = {
    name: 'slidesorter',
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
        console.error('[slidesorter plugin] Failed to load builder module:', err);
        return [];
      }
    }
  };
})();
