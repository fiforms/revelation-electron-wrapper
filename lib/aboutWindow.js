// This module handles the About window functionality in the Electron app.

const { BrowserWindow, app, ipcMain } = require('electron');

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
        aboutWin.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/admin/about.html`);
    }
}

module.exports = {
    aboutWindow
};
