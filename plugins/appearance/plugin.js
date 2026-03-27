const appearancePlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 131,
  version: '11.11.1.a',
  config: {},
  configTemplate: [],
  register(AppContext) {
    AppContext.log('[appearance-plugin] Registered!');
  }
};

module.exports = appearancePlugin;
