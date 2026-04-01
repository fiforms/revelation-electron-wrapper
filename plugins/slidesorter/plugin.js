const slideSorterPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 140,
  version: '1.0.6',
  config: {},
  register(AppContext) {
    AppContext.log('[slidesorter-plugin] Registered');
  }
};

module.exports = slideSorterPlugin;
