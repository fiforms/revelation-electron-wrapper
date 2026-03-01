const markerboardPlugin = {
  priority: 95,
  version: '0.1.0',
  exposeToBrowser: true,
  clientHookJS: 'client.js',
  config: {},
  configTemplate: [],
  register(AppContext) {
    AppContext.log('[markerboard-plugin] Registered');
  },
  api: {}
};

module.exports = markerboardPlugin;
