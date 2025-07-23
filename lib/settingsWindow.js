const { BrowserWindow, app, dialog } = require('electron');


const settingsWindow = {
  register(ipcMain, AppContext) {
    AppContext.callbacks['menu:settings'] = () => this.open(AppContext);
    AppContext.callbacks['menu:reset-settings'] = () => this.reset(AppContext);
  },
  open(AppContext) {
    const win = new BrowserWindow({
      width: 500,
      height: 700,
      webPreferences: { preload: AppContext.preload }
    });
    win.setMenu(null);
    win.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/admin/settings.html`);
  },
  reset(AppContext) {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(app.getPath('userData'), 'config.json');

    const response = dialog.showMessageBoxSync(AppContext.win, {
      type: 'question',
      buttons: ['Cancel', 'Reset'],
      defaultId: 1,
      cancelId: 0,
      title: 'Confirm Reset',
      message: 'Are you sure you want to reset all settings to default?',
      detail: 'This action cannot be undone.'
    });

    if (response !== 1) return; // Cancelled

    let message;
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
      message = 'Settings reset to default.';
    } else {
      message = 'No settings file found to reset.';
    }

    AppContext.log(message);
    AppContext.win.webContents.send('show-toast', message);

    dialog.showMessageBoxSync(AppContext.win, {
      type: 'info',
      buttons: ['OK'],
      title: 'Reset Complete',
      message
    });
  }
};
module.exports = { settingsWindow };
