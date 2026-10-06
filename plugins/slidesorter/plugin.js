// plugins/slidesorter/plugin.js
//
// Slide Sorter: builder-only drag-and-drop slide/column sorter, plus an
// enhanced slide-navigator tile renderer and slide clipboard (copy/cut/paste
// across presentations). Main-process half is metadata only.
// Hooks: clientHookJS 'client.js', exposeToBrowser true, priority 140.
// No config keys, IPC channels, or external services. Enabled by default on
// first run. Logic lives in builder.js (loaded lazily from client.js).

const slideSorterPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 140,
  config: {},
  register(AppContext) {
    AppContext.log('[slidesorter-plugin] Registered');
  }
};

module.exports = slideSorterPlugin;
