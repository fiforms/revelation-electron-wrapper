const markerboardPlugin = {
  priority: 95,
  version: '0.1.0',
  exposeToBrowser: true,
  clientHookJS: 'client.js',
  config: {},
  configTemplate: [
    {
      name: 'privateMode',
      type: 'boolean',
      description: 'Private Mode: Only master presenter can draw on markerboard.',
      default: false
    }
  ],
  register(AppContext) {
    AppContext.log('[markerboard-plugin] Registered');
  },
  api: {}
};

module.exports = markerboardPlugin;
