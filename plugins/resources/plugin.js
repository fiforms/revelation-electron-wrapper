// plugins/resources/plugin.js
//
// Resources: a static help/links page (resources/index.html with About, Images &
// Media, Text & Editors tabs; localized variants index.<lang>.html chosen by
// resources.js). It does NOT manage per-presentation resource files.
// Hooks: priority 90, exposeToBrowser true (but no clientHookJS, so nothing is
// loaded into pages), pluginButtons -> sidebar entry "Resources" -> index.html.
// No config keys, IPC channels (api is empty), or external services; external
// links open via window.electronAPI.openExternalURL. Enabled by default.

const resourcesPlugin = {
    priority: 90,
    exposeToBrowser: true,
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
