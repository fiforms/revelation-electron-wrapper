const fs = require('fs');
const path = require('path');

module.exports = {
  async build(context) {
    const clientEntry = path.join(context.pluginDir, 'client.js');
    const clientDir = path.join(context.pluginDir, 'client');
    if (!fs.existsSync(clientEntry) || !fs.existsSync(clientDir)) {
      throw new Error('markerboard client assets are missing.');
    }
  },

  async export(context) {
    return {
      pluginListEntry: {
        baseURL: './_resources/plugins/markerboard',
        priority: Number.isFinite(context.plugin?.priority) ? context.plugin.priority : 95,
        config: context.pluginConfig || {},
        clientHookJS: 'client.js'
      },
      copy: [
        { from: 'client.js', to: 'plugins/markerboard/client.js' },
        { from: 'client', to: 'plugins/markerboard/client' }
      ]
    };
  }
};
