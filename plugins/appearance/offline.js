const fs = require('fs');
const path = require('path');

module.exports = {
  async build(context) {
    const bundlePath = path.join(context.pluginDir, 'appearance', 'plugin.bundle.mjs');
    if (!fs.existsSync(bundlePath)) {
      throw new Error('appearance/plugin.bundle.mjs is missing. Run scripts/copy-plugins.js before offline build.');
    }
  },

  async export(context) {
    return {
      pluginListEntry: {
        baseURL: './_resources/plugins/appearance',
        priority: Number.isFinite(context.plugin?.priority) ? context.plugin.priority : 131,
        config: {},
        clientHookJS: 'client.js'
      },
      copy: [
        { from: 'client.js', to: 'plugins/appearance/client.js' },
        { from: 'appearance/plugin.bundle.mjs', to: 'plugins/appearance/appearance/plugin.bundle.mjs' },
        { from: 'appearance/plugin.bundle.js', to: 'plugins/appearance/appearance/plugin.bundle.js' },
        { from: 'appearance/appearance.css', to: 'plugins/appearance/appearance/appearance.css' }
      ]
    };
  }
};
