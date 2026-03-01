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
      description: 'If enabled, only the presenter/master session can draw or broadcast markerboard changes',
      default: false
    }
  ],
  register(AppContext) {
    AppContext.log('[markerboard-plugin] Registered');
  },
  api: {}
};

module.exports = markerboardPlugin;
