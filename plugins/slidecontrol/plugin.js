const slidecontrolPlugin = {
  priority: 96,
  version: '0.1.0',
  exposeToBrowser: true,
  clientHookJS: 'client.js',
  config: {},
  register(AppContext) {
    AppContext.log('[slidecontrol-plugin] Registered');
  },
  api: {}
};

module.exports = slidecontrolPlugin;
