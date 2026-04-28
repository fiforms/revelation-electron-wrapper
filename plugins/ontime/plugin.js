const ontimePlugin = {
  priority: 110,
  version: '1.0.0',
  exposeToBrowser: true,
  clientHookJS: 'client.js',
  defaultEnabled: false,
  config: {
    pollUrl: ''
  },
  configTemplate: [
    {
      name: 'pollUrl',
      type: 'string',
      description: 'Ontime Poll API URL — the endpoint that returns OnTime timer JSON (e.g. https://example.com/api/poll).',
      default: ''
    }
  ],

  register(AppContext) {
    AppContext.log('[ontime-plugin] Registered');
  }
};

module.exports = ontimePlugin;
