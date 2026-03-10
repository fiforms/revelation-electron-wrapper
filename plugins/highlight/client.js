// plugins/highlight/client.js
// Example to show how to load a Reveal.js plugin using the revelation-electron-wrapper plugin framework

(function () {
  async function loadHighlightModule(baseURL) {
    try {
      return await import(`${baseURL}/highlight/plugin.bundle.mjs`);
    } catch (err) {
      const message = String(err?.message || '');
      const likelyMimeIssue =
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('Expected a JavaScript-or-Wasm module script');

      if (!likelyMimeIssue) {
        throw err;
      }

      return import(`${baseURL}/highlight/plugin.bundle.js`);
    }
  }

  window.RevelationPlugins['highlight'] = {
    name: 'highlight',
    context: null,

    init(context) {
      this.context = context;

      // Inject highlight.js theme CSS
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${this.context.baseURL}/highlight/${this.context.config.stylesheet}`;
      document.head.appendChild(link);
    },
    async getRevealPlugins(isRemote) {
      const module = await loadHighlightModule(this.context.baseURL);
      return [ module.default ];
    }
  }
})();
