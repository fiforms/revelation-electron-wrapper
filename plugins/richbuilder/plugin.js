// plugins/richbuilder/plugin.js
//
// Rich Builder: WYSIWYG contenteditable slide editor inside the Presentation
// Builder (http_admin/builder). Main-process half is metadata only.
// Hooks: clientHookJS 'client.js', exposeToBrowser true, priority 142.
// No config keys, IPC channels or external services. Enabled by default on
// first run. All logic is client-side; see builder.js (entry point) and the
// builder-*.js / color-spans.js modules.

const richbuilderPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 142,
  config: {},
  register(AppContext) {
    AppContext.log('[richbuilder-plugin] Registered');
  }
};

module.exports = richbuilderPlugin;
