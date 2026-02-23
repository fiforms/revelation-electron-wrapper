// plugins/resources/plugin.js

const resourcesPlugin = {
    priority: 90,
    version: '0.2.7',
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
