const fs = require('fs');
const path = require('path');

module.exports = {
  async build(context) {
    const bundlePath = path.join(context.pluginDir, 'math', 'plugin.bundle.mjs');
    if (!fs.existsSync(bundlePath)) {
      throw new Error('math/plugin.bundle.mjs is missing. Run scripts/copy-plugins.js before offline build.');
    }
  },

  async export(context) {
    return {
      pluginListEntry: {
        baseURL: './_resources/plugins/math',
        priority: Number.isFinite(context.plugin?.priority) ? context.plugin.priority : 130,
        config: {
          typesetter: context.pluginConfig?.typesetter || 'mathjax2'
        },
        clientHookJS: 'client.js'
      },
      copy: [
        { from: 'client.js', to: 'plugins/math/client.js' },
        { from: 'math/plugin.bundle.mjs', to: 'plugins/math/math/plugin.bundle.mjs' }
      ]
    };
  }
};
