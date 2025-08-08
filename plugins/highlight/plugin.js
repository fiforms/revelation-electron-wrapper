const highlightPlugin = {
  clientHookJS: 'client.js',
  priority: 129,
  config: {},
  configTemplate: [
    {
      name: 'stylesheet',
      type: 'string',
      description: 'CSS Stylesheet for syntax highlighting',
      default: 'github.min.css'
    }
  ],
  register(AppContext) {
    AppContext.log('[highlight-plugin] Registered!');
  }
};

module.exports = highlightPlugin;