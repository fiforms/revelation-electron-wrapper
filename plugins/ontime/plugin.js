const ontimePlugin = {
  priority: 110,
  version: '1.0.9',
  exposeToBrowser: true,
  clientHookJS: 'client.js',
  defaultEnabled: false,
  config: {
    pollUrl: '',
    pollIntervalSeconds: 5
  },
  configTemplate: [
    {
      name: 'pollUrl',
      type: 'string',
      description: 'Ontime Poll API URL — the endpoint that returns OnTime timer JSON (e.g. https://example.com/api/poll).',
      default: ''
    },
    {
      name: 'pollIntervalSeconds',
      type: 'number',
      description: 'How often (in seconds) to poll the Ontime API for lower-third updates. Minimum 1.',
      default: 5
    }
  ],

  register(AppContext) {
    AppContext.log('[ontime-plugin] Registered');
  }
};

module.exports = ontimePlugin;
