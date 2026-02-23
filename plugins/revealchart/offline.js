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
        { from: 'builder.js', to: 'plugins/revealchart/builder.js' },
        { from: 'builder-dialog-template.js', to: 'plugins/revealchart/builder-dialog-template.js' },
        { from: 'markdown-preprocessor.js', to: 'plugins/revealchart/markdown-preprocessor.js' },
        { from: 'csv-utils.js', to: 'plugins/revealchart/csv-utils.js' },
        { from: 'table-processor.js', to: 'plugins/revealchart/table-processor.js' },
        { from: 'revealchart', to: 'plugins/revealchart/revealchart' }
      ]
    };
  }
};
