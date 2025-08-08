const highlightPlugin = {
  clientHookJS: 'client.js',
  priority: 129,
  register(AppContext) {
    AppContext.log('[highlight-plugin] Registered!');
  }
};

module.exports = highlightPlugin;