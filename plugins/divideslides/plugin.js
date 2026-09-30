const divideSlidesPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 140,
  config: {},
  configTemplate: [],
  register(AppContext) {
    AppContext.log('[divideslides-plugin] Registered!');
  }
};

module.exports = divideSlidesPlugin;
