const divideSlidesPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 140,
  version: '1.0.0',
  config: {},
  configTemplate: [],
  register(AppContext) {
    AppContext.log('[divideslides-plugin] Registered!');
  }
};

module.exports = divideSlidesPlugin;
