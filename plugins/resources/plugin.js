// plugins/resources/plugin.js
//
// Resources: a static help/links page (resources/index.html with About, Images &
// Media, Text & Editors tabs; localized variants index.<lang>.html chosen by
// resources.js). It does NOT manage per-presentation resource files.
// Hooks: priority 90, pluginButtons -> sidebar entry "Resources" -> index.html. No clientHookJS,
// so nothing is loaded into pages (and it is not listed in plugins.json).
// No config keys, IPC channels (api is empty), or external services; external
// links open via window.electronAPI.openExternalURL. Enabled by default.

const resourcesPlugin = {
    priority: 90,
    pluginButtons: [
            { "title": "Resources", "page": "index.html" },
        ],
        register(AppContext) {
        AppContext.log("[resources] Registered");
    },
    api: {

    }
};

module.exports = resourcesPlugin;
