const appearancePlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 131,
  config: {},
  configTemplate: [],
  register(AppContext) {
    AppContext.log('[appearance-plugin] Registered!');
  }
};

module.exports = appearancePlugin;
