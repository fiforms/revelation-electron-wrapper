module.exports = {
  async export(context) {
    return {
      pluginListEntry: {
        baseURL: './_resources/plugins/credit_ccli',
        priority: Number.isFinite(context.plugin?.priority) ? context.plugin.priority : 120,
        config: context.pluginConfig || {},
        clientHookJS: 'client.js'
      },
      copy: [
        { from: 'client.js', to: 'plugins/credit_ccli/client.js' },
        { from: 'markdown-preprocessor.js', to: 'plugins/credit_ccli/markdown-preprocessor.js' }
      ]
    };
  }
};
