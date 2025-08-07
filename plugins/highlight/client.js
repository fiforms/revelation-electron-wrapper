// plugins/highlight/client.js
// Example to show how to load a Reveal.js plugin using the revelation-electron-wrapper plugin framework

(function () {

  window.RevelationPlugins['highlight'] = {
    name: 'highlight',
    context: null,

    init(context) {
      this.context = context;
    },
    async getRevealPlugins(isRemote) {
      const module = await import(this.context.baseURL + '/highlight/plugin.bundle.mjs');
      return [ module.default ];
    }
  }
})();
