// plugins/ontime/plugin.js
//
// OnTime integration: main-process half is metadata only. All work (polling,
// markdown :ontime: blocks, countdown handler) is in client.js.
//
// Hooks / manifest fields:
//   - clientHookJS: 'client.js', exposeToBrowser: true, priority 110
//   - defaultEnabled: false
//   - configTemplate / config keys: pollUrl (OnTime /api/poll URL),
//     pollIntervalSeconds (lower-third poll interval, min 1, default 5)
//   - external service: the user-configured OnTime server, fetched directly
//     from the browser (so it must allow CORS)
//   - no IPC channels

const ontimePlugin = {
  priority: 110,
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
