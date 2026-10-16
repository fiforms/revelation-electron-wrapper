// plugins/mathjax/offline.js
//
// Offline-export hook, loaded by lib/exportPresentation.js. build() verifies the vendored MathJax
// exists (it is produced by scripts/copy-plugins.js); export() registers the plugin in the exported
// page's plugin list and copies the client scripts plus the mathjax/ folder (bundle, TeX
// extensions, font chunks) into _resources/plugins/mathjax/. builder.js is not exported.

const fs = require('fs');
const path = require('path');

module.exports = {
  async build(context) {
    const bundlePath = path.join(context.pluginDir, 'mathjax', 'tex-svg.js');
    if (!fs.existsSync(bundlePath)) {
      throw new Error('mathjax/tex-svg.js is missing. Run scripts/copy-plugins.js before offline build.');
    }
  },

  async export(context) {
    return {
      pluginListEntry: {
        baseURL: './_resources/plugins/mathjax',
        priority: Number.isFinite(context.plugin?.priority) ? context.plugin.priority : 130,
        config: {},
        clientHookJS: 'client.js'
      },
      copy: [
        { from: 'client.js', to: 'plugins/mathjax/client.js' },
        { from: 'mathjax-block.js', to: 'plugins/mathjax/mathjax-block.js' },
        { from: 'mathjax-loader.js', to: 'plugins/mathjax/mathjax-loader.js' },
        { from: 'mathjax', to: 'plugins/mathjax/mathjax' }
      ]
    };
  }
};
