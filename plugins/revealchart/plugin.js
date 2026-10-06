// plugins/revealchart/plugin.js
//
// RevealChart: `:chart:` / `:table:` YAML blocks rendered with Chart.js.
// Main-process half is metadata only. Hooks: clientHookJS 'client.js'
// (ES module), exposeToBrowser true, priority 128. No config keys, IPC,
// or external services (Chart.js is vendored in revealchart/revealchart/).
// Offline export: offline.js. Not in the default plugin list.
// Do not confuse plugins/revealchart/ (wrapper plugin) with its vendored
// runtime subfolder plugins/revealchart/revealchart/ (Reveal.js plugin + Chart.js).

const revealChartPlugin = {
  // Client-side hook consumed by revelation/js/pluginloader.js.
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 128,
  config: {},
  // Server/plugin registration hook for plugin manager diagnostics.
  register(AppContext) {
    AppContext.log('[revealchart-plugin] Registered!');
  }
};

module.exports = revealChartPlugin;
