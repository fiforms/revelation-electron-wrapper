// plugins/mathjax/plugin.js
//
// Math equations plugin (MathJax 4): main-process half. Pure metadata; all work is client-side.
// Renamed from `math` (which offered MathJax 2/3 or KaTeX from a CDN); lib/configManager.js
// loadConfig() carries an enabled `math` over to `mathjax`.
//
// Hooks / manifest fields:
//   - clientHookJS: 'client.js', exposeToBrowser: true (listed in plugins.json), priority 130
//   - no settings, IPC channels, menu items or external services
// Client side: client.js (preprocessMarkdown for `:mathjax:`, reveal plugin, Rich Builder dialog in
// builder.js). MathJax itself is vendored into mathjax/ by scripts/copy-plugins.js (gitignored).
// Offline export: offline.js.
// Not in the first-run default plugin list (see lib/configManager.js defaultPlugins).

const mathjaxPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 130,
  config: {},
  register(AppContext) {
    AppContext.log('[mathjax-plugin] Registered!');
  }
};

module.exports = mathjaxPlugin;
