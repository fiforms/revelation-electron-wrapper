const fs = require('fs');
const path = require('path');

module.exports = {
  async build(context) {
    const dir = path.join(context.pluginDir, 'overlaywidgets');
    if (!fs.existsSync(path.join(dir, 'calendar', 'manifest.json'))) {
      throw new Error('widgets/overlaywidgets is missing. Run: git submodule update --init plugins/widgets/overlaywidgets');
    }
  },

  async export(context) {
    return {
      pluginListEntry: {
        baseURL: './_resources/plugins/widgets',
        priority: Number.isFinite(context.plugin?.priority) ? context.plugin.priority : 106,
        config: {},
        clientHookJS: 'client.js'
      },
      // Widgets that need outside data (calendar, weather) have no host server
      // offline and show their "unavailable" state; clock and hello work.
      copy: [
        { from: 'client.js', to: 'plugins/widgets/client.js' },
        { from: 'validate.js', to: 'plugins/widgets/validate.js' },
        { from: 'overlaywidgets/clock', to: 'plugins/widgets/overlaywidgets/clock' },
        { from: 'overlaywidgets/hello', to: 'plugins/widgets/overlaywidgets/hello' },
        { from: 'overlaywidgets/calendar', to: 'plugins/widgets/overlaywidgets/calendar' },
        { from: 'overlaywidgets/weather', to: 'plugins/widgets/overlaywidgets/weather' }
      ]
    };
  }
};
