const markerboardPlugin = {
  priority: 95,
  version: '0.1.0',
  exposeToBrowser: true,
  clientHookJS: 'client.js',
  config: {},
  configTemplate: [
    {
      name: 'publicMode',
      type: 'boolean',
      description: 'Public Mode: Any connected peer can draw on markerboard.',
      default: false
    },
    {
      name: 'allowPeerFirstToggle',
      type: 'boolean',
      description: 'Peer First: Allow markerboard to be enabled first on any peer.',
      default: false
    }
  ],
  register(AppContext) {
    AppContext.log('[markerboard-plugin] Registered');
  },
  api: {}
};

module.exports = markerboardPlugin;
