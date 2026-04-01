const revealChartPlugin = {
  // Client-side hook consumed by revelation/js/pluginloader.js.
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 128,
  version: '1.0.6',
  config: {},
  // Server/plugin registration hook for plugin manager diagnostics.
  register(AppContext) {
    AppContext.log('[revealchart-plugin] Registered!');
  }
};

module.exports = revealChartPlugin;
