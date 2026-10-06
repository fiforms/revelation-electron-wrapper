// plugins/divideslides/plugin.js  (main process)
// Stub: exposes client.js only (priority 140, no config/IPC/network/files).
const divideSlidesPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 140,
  config: {},
  configTemplate: [],
  register(AppContext) {
    AppContext.log('[divideslides-plugin] Registered!');
  }
};

module.exports = divideSlidesPlugin;
