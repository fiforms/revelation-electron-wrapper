// This module handles the About window functionality in the Electron app.
// Window: 600x500, menu removed, preload.js, loads /admin/about.html from Vite.
// IPC: get-app-version, get-ffmpeg-info (bundled versions.txt). Menu callback: menu:about.
// Required by main.js.

const { BrowserWindow, app } = require('electron');
const { buildServerURL } = require('./serverUrl');
const { getFfmpegVersionInfo } = require('./ffmpegResolver');

const aboutWindow = {
    register(ipcMain, AppContext) {

        AppContext.callbacks['menu:about'] = () => {
            this.open(AppContext);
        };

        ipcMain.handle('get-app-version', () => {
            return app.getVersion();
        });

        ipcMain.handle('get-ffmpeg-info', () => {
            return {
                version: getFfmpegVersionInfo(),
                platform: process.platform,
            };
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
