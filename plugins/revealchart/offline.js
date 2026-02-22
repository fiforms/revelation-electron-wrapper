const fs = require('fs');
const path = require('path');

module.exports = {
  async build(context) {
    const assetsDir = path.join(context.pluginDir, 'revealchart');
    const pluginScript = path.join(assetsDir, 'plugin.js');
    const chartBundle = path.join(assetsDir, 'chart.umd.min.js');

    if (!fs.existsSync(pluginScript) || !fs.existsSync(chartBundle)) {
      throw new Error('revealchart assets are missing. Run scripts/copy-plugins.js before offline build.');
    }
  },

  async export(context) {
    return {
      pluginListEntry: {
        baseURL: './_resources/plugins/revealchart',
        priority: Number.isFinite(context.plugin?.priority) ? context.plugin.priority : 128,
        config: context.pluginConfig || {},
        clientHookJS: 'client.js'
      },
      copy: [
        { from: 'client.js', to: 'plugins/revealchart/client.js' },
        { from: 'revealchart', to: 'plugins/revealchart/revealchart' }
      ]
    };
  }
};
