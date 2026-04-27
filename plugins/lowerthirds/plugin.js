const lowerthirdsPlugin = {
  priority: 105,
  version: '1.0.0',
  exposeToBrowser: true,
  clientHookJS: 'client.js',
  defaultEnabled: false,
  config: {
    defaultStyle: 'colorful'
  },
  configTemplate: [
    {
      name: 'defaultStyle',
      type: 'string',
      description: 'Default theme name (without .svg) used when a :lt: block does not specify a style.',
      default: 'colorful'
    }
  ],

  register(AppContext) {
    AppContext.log('[lowerthirds-plugin] Registered');
  }
};

module.exports = lowerthirdsPlugin;
