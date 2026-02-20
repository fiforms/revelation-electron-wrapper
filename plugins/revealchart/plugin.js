const revealChartPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 128,
  version: '0.1.0',
  config: {},
  register(AppContext) {
    AppContext.log('[revealchart-plugin] Registered!');
  }
};

module.exports = revealChartPlugin;
