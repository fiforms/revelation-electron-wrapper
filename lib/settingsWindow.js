const { BrowserWindow, app, dialog } = require('electron');


const settingsWindow = {
  register(ipcMain, AppContext) {
    AppContext.callbacks['menu:settings'] = () => this.open(AppContext);
    AppContext.callbacks['menu:reset-settings'] = () => this.reset(AppContext);
  },
  open(AppContext) {
    const key = AppContext.config.key;
    AppContext.win.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/admin/settings.html?key=${key}`);
  },
  reset(AppContext) {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(app.getPath('userData'), 'config.json');

    const response = dialog.showMessageBoxSync(AppContext.win, {
      type: 'question',
      buttons: [AppContext.translate('Cancel'), AppContext.translate('Reset')],
      defaultId: 1,
      cancelId: 0,
      title: AppContext.translate('Confirm Reset'),
      message: AppContext.translate('Are you sure you want to reset all settings and plugins to default?'),
      detail: AppContext.translate('This action cannot be undone.')
    });

    if (response !== 1) return; // Cancelled

    AppContext.log("Resetting settings and plugins to default.");
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
      AppContext.log('Deleted config file ' + configPath);
    }
    else {
      AppContext.log('No config file found at ' + configPath);
    }
    // Also remove plugins and revelation folders to reset to default
    const pluginsPath = path.join(app.getPath('userData'), 'resources', 'plugins');
    if (fs.existsSync(pluginsPath)) {
      fs.rmSync(pluginsPath, { recursive: true, force: true });
      AppContext.log('Deleted plugins folder' + pluginsPath);
    }
    else {
      AppContext.log('No plugins folder found at ' + pluginsPath);
    }
    const revelationPath = path.join(app.getPath('userData'), 'resources', 'revelation');
    if (fs.existsSync(revelationPath)) {
      fs.rmSync(revelationPath, { recursive: true, force: true });
      AppContext.log('Deleted revelation folder ' + revelationPath);
    }
    else {
      AppContext.log('No revelation folder found at ' + revelationPath);
    }

    const message = AppContext.translate('Settings reset to default.');

    AppContext.win.webContents.send('show-toast', message);

    dialog.showMessageBoxSync(AppContext.win, {
      type: 'info',
      buttons: ['OK'],
      title: 'Reset Complete',
      message
    });

    AppContext.reloadServers();
  }
};
module.exports = { settingsWindow };
