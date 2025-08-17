const fs = require('fs');
const path = require('path');

const highlightPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 129,
  config: {},
  configTemplate: [
    {
      name: 'stylesheet',
      type: 'string',
      description: 'CSS Stylesheet for syntax highlighting',
      default: 'github.min.css',
      ui: 'dropdown',
      dropdownsrc: function () {
        try {
          const themeDir = path.join(__dirname, 'highlight');
          return fs
            .readdirSync(themeDir)
            .filter(file => file.endsWith('.min.css'))
            .sort();
        } catch (err) {
          console.warn('[highlight-plugin] Failed to list themes:', err.message);
          return [];
        }
      }
    }
  ],
  register(AppContext) {
    AppContext.log('[highlight-plugin] Registered!');
  }
};

module.exports = highlightPlugin;
