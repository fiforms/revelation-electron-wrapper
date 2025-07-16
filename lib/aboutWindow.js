// This module handles the About window functionality in the Electron app.

const { BrowserWindow } = require('electron');

const aboutWindow = {
    register(ipcMain, AppContext) {

        AppContext.callbacks['menu:about'] = () => {
            this.open(AppContext);
        };
    },
    open(AppContext) {
        const createWin = new BrowserWindow({
        width: 600,
        height: 500,
        webPreferences: {
            preload: AppContext.preload,
        },
        });

        createWin.setMenu(null); // 🚫 Remove the menu bar
        createWin.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/about.html`);
    }
}

module.exports = {
    aboutWindow
};
