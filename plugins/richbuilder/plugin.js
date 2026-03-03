const richbuilderPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 142,
  version: '0.1.0',
  config: {},
  register(AppContext) {
    AppContext.log('[richbuilder-plugin] Registered');
  }
};

module.exports = richbuilderPlugin;
