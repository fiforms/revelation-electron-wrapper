// plugins/math/offline.js
//
// Offline-export hook, loaded by lib/exportPresentation.js. build() verifies the
// reveal.js math bundle exists (it is produced by scripts/copy-plugins.js);
// export() registers the plugin in the exported page's plugin list and copies
// client.js plus math/plugin.bundle.mjs into _resources/plugins/math/.
// Only the .mjs bundle is copied (client.js's .js fallback is not included).

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
