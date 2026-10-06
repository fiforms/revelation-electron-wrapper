// plugins/math/plugin.js
//
// Math equations plugin: main-process half. Pure metadata; all work is client-side.
//
// Hooks / manifest fields:
//   - clientHookJS: 'client.js', exposeToBrowser: true (listed in plugins.json), priority 130
//   - configTemplate: `typesetter` (dropdown: mathjax2 | mathjax3 | katex, default mathjax2)
//   - no IPC channels, no menu items, no external services
// Offline export: offline.js (copies client.js + math/plugin.bundle.mjs).
// Not in the first-run default plugin list (see lib/configManager.js defaultPlugins).

const mathPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 130,
  config: {},
  configTemplate: [
    {
      name: 'typesetter',
      type: 'string',
      description: 'Math typesetting engine',
      default: 'mathjax2',
      ui: 'dropdown',
      dropdownsrc: function () {
        return ['mathjax2', 'mathjax3', 'katex'];
      }
    }
  ],
  register(AppContext) {
    AppContext.log('[math-plugin] Registered!');
  }
};

module.exports = mathPlugin;
