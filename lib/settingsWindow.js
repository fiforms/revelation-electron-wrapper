const { BrowserWindow } = require('electron');


const settingsWindow = {
  register(ipcMain, AppContext) {
    AppContext.callbacks['menu:settings'] = () => this.open(AppContext);
  },
  open(AppContext) {
    const win = new BrowserWindow({
      width: 600,
      height: 400,
      webPreferences: { preload: AppContext.preload }
    });
    win.setMenu(null);
    win.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/admin/settings.html`);
  }
};
module.exports = { settingsWindow };
