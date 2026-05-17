// This module handles the About window functionality in the Electron app.

const { BrowserWindow, app, ipcMain } = require('electron');
const { buildServerURL } = require('./serverUrl');

const aboutWindow = {
    register(ipcMain, AppContext) {

        AppContext.callbacks['menu:about'] = () => {
            this.open(AppContext);
        };

        ipcMain.handle('get-app-version', () => {
            return app.getVersion();
        });
    },
    open(AppContext) {
        const aboutWin = new BrowserWindow({
        width: 600,
        height: 500,
        webPreferences: {
            preload: AppContext.preload,
        },
        });
        //aboutWin.webContents.openDevTools()  // Uncomment for debugging
        aboutWin.setMenu(null); // 🚫 Remove the menu bar
        const url = buildServerURL(AppContext.hostURL, AppContext.config.viteServerPort, AppContext.config.httpsEnabled);
        aboutWin.loadURL(`${url}/admin/about.html`);
    }
}

module.exports = {
    aboutWindow
};
