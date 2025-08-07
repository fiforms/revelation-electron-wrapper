const highlightPlugin = {
  clientHookJS: 'client.js',
  register(AppContext) {
    AppContext.log('[highlight-plugin] Registered!');
  }
};

module.exports = highlightPlugin;