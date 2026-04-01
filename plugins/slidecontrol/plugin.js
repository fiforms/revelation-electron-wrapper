const slidecontrolPlugin = {
  priority: 96,
  version: '1.0.6',
  exposeToBrowser: true,
  clientHookJS: 'client.js',
  config: {},
  configTemplate: [
    {
      name: 'allowControlFromAnyClient',
      type: 'boolean',
      description: 'Allow control requests from remote peer clients through the shared socket.',
      default: true
    }
  ],
  register(AppContext) {
    AppContext.log('[slidecontrol-plugin] Registered');
  },
  api: {}
};

module.exports = slidecontrolPlugin;
