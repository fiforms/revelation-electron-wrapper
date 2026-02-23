const fs = require('fs');
const path = require('path');

const DEFAULT_STYLESHEET = 'github.min.css';

function resolveThemeFilename(pluginDir, configuredTheme) {
  const requested = String(configuredTheme || '').trim() || DEFAULT_STYLESHEET;
  const requestedPath = path.join(pluginDir, 'highlight', requested);
  if (fs.existsSync(requestedPath)) {
    return requested;
  }

  const fallbackPath = path.join(pluginDir, 'highlight', DEFAULT_STYLESHEET);
  if (fs.existsSync(fallbackPath)) {
    return DEFAULT_STYLESHEET;
  }

  throw new Error('No highlight theme CSS found. Run scripts/copy-plugins.js first.');
}

module.exports = {
  async build(context) {
    const bundlePath = path.join(context.pluginDir, 'highlight', 'plugin.bundle.mjs');
    if (!fs.existsSync(bundlePath)) {
      throw new Error('highlight/plugin.bundle.mjs is missing. Run scripts/copy-plugins.js before offline build.');
    }
  },

  async export(context) {
    const stylesheet = resolveThemeFilename(context.pluginDir, context.pluginConfig?.stylesheet);

    return {
      pluginListEntry: {
        baseURL: './_resources/plugins/highlight',
        priority: Number.isFinite(context.plugin?.priority) ? context.plugin.priority : 129,
        config: {
          stylesheet
        },
        clientHookJS: 'client.js'
      },
      copy: [
        { from: 'client.js', to: 'plugins/highlight/client.js' },
        { from: 'highlight/plugin.bundle.mjs', to: 'plugins/highlight/highlight/plugin.bundle.mjs' },
        { from: `highlight/${stylesheet}`, to: `plugins/highlight/highlight/${stylesheet}` }
      ]
    };
  }
};
