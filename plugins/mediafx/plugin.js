// plugins/mediafx/plugin.js
const { BrowserWindow } = require('electron');
let AppCtx = null;

module.exports = {
    priority: 104,
    version: '0.1.0',

    register(AppContext) {
        AppCtx = AppContext;
        AppContext.log('[mediafx] plugin registered');
    },
    api: {

    },
    pluginButtons: [
            { "title": "Motion FX", "page": "ui.html" },
        ]
};
