// plugins/mdvalidate/client.js
//
// Browser-side hook. Only on the Presentation Builder page (context.page ===
// 'builder') does it lazy-import ./builder.js and return its
// getBuilderExtensions(ctx) result; elsewhere it contributes nothing.
// Validation itself runs in the main process (plugin.js api.validate).

(function () {
  'use strict';

  function isBuilderPage(context) {
    return String(context?.page || '').trim().toLowerCase() === 'builder';
  }

  window.RevelationPlugins = window.RevelationPlugins || {};
  window.RevelationPlugins.mdvalidate = {
    name: 'mdvalidate',
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
        console.error('[mdvalidate] Failed to load builder module:', err);
        return [];
      }
    }
  };
})();
