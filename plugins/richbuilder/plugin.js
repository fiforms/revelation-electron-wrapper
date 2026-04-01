const richbuilderPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 142,
  version: '1.0.6',
  config: {},
  register(AppContext) {
    AppContext.log('[richbuilder-plugin] Registered');
  }
};

module.exports = richbuilderPlugin;
