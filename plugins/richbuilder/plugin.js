const richbuilderPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 142,
  config: {},
  register(AppContext) {
    AppContext.log('[richbuilder-plugin] Registered');
  }
};

module.exports = richbuilderPlugin;
