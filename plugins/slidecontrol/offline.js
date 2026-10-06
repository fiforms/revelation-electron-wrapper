// plugins/slidecontrol/offline.js
//
// Offline-export hook (lib/exportPresentation.js): verifies client.js exists
// and copies it to _resources/plugins/slidecontrol/. Config is passed through
// unchanged from the app's pluginConfigs.slidecontrol.

const fs = require('fs');
const path = require('path');

module.exports = {
  async build(context) {
    const clientEntry = path.join(context.pluginDir, 'client.js');
    if (!fs.existsSync(clientEntry)) {
      throw new Error('slidecontrol client assets are missing.');
    }
  },

  async export(context) {
    return {
      pluginListEntry: {
        baseURL: './_resources/plugins/slidecontrol',
        priority: Number.isFinite(context.plugin?.priority) ? context.plugin.priority : 96,
        config: context.pluginConfig || {},
        clientHookJS: 'client.js'
      },
      copy: [
        { from: 'client.js', to: 'plugins/slidecontrol/client.js' }
      ]
    };
  }
};
