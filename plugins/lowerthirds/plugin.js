// plugins/lowerthirds/plugin.js  (main process)
// Stub: config defaultStyle only; priority 105, exposeToBrowser.
// Rendering is client-side (client.js + themes/*.svg).
const lowerthirdsPlugin = {
  priority: 105,
  exposeToBrowser: true,
  clientHookJS: 'client.js',
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
