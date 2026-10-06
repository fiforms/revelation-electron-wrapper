// plugins/markerboard/plugin.js  (main process)
// Stub: config publicMode / allowPeerFirstToggle (read by client.js); priority 95,
// exposeToBrowser. No IPC. See client.js and client/*.js for the implementation.
const markerboardPlugin = {
  priority: 95,
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
