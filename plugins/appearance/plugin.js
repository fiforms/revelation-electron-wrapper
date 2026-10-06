// plugins/appearance/plugin.js  (main process)
// Stub: registers the plugin so client.js is served (exposeToBrowser). No config,
// IPC, or file access. All behaviour is in client.js (animate.css / reveal.js-appearance).
const appearancePlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 131,
  config: {},
  configTemplate: [],
  register(AppContext) {
    AppContext.log('[appearance-plugin] Registered!');
  }
};

module.exports = appearancePlugin;
