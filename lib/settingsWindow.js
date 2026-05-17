const { BrowserWindow, app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { buildServerURL } = require('./serverUrl');

const settingsWindow = {
  register(ipcMain, AppContext) {
    AppContext.callbacks['menu:settings'] = () => this.open(AppContext);
    AppContext.callbacks['menu:reset-profile'] = () => this.resetProfile(AppContext);
    AppContext.callbacks['menu:reset-plugins'] = () => this.resetPlugins(AppContext);
    AppContext.callbacks['menu:delete-profile'] = () => this.deleteProfile(AppContext);
  },

  open(AppContext) {
    const key = AppContext.config.key;
    const baseURL = buildServerURL(AppContext.hostURL, AppContext.config.viteServerPort, AppContext.config.httpsEnabled);
    AppContext.win.loadURL(`${baseURL}/admin/settings.html?key=${key}`);
  },

  deleteProfile(AppContext) {
    const profileName = typeof AppContext.config.profile === 'string' && AppContext.config.profile.trim() && AppContext.config.profile.trim() !== 'Default'
      ? AppContext.config.profile.trim()
      : null;

    if (!profileName) {
      dialog.showMessageBoxSync(AppContext.win, {
        type: 'error',
        buttons: ['OK'],
        title: AppContext.translate('Cannot Delete Default Profile'),
        message: AppContext.translate('The Default profile cannot be deleted. Please switch to a different profile before attempting to delete.')
      });
      return;
    }

    const response = dialog.showMessageBoxSync(AppContext.win, {
      type: 'warning',
      buttons: [AppContext.translate('Cancel'), AppContext.translate('Delete')],
      defaultId: 1,
      cancelId: 0,
      title: AppContext.translate('Confirm Delete'),
      message: AppContext.translate('Delete current profile?'),
      detail: `${AppContext.translate('This will permanently delete the')} "${profileName}" ${AppContext.translate('profile and all its settings. This action cannot be undone.')}`
    });

    if (response !== 1) return;

    AppContext.log(`Deleting profile "${profileName}".`);

    const { profilesDir, setActiveProfile, loadConfig } = require('./configManager');
    const profilePath = path.join(profilesDir, `${profileName}.config.json`);
    setActiveProfile('Default');
    if (fs.existsSync(profilePath)) {
      fs.rmSync(profilePath, { force: true });
      AppContext.log('Deleted profile file at ' + profilePath);
    } else {
      AppContext.log('No profile file found at ' + profilePath);
    }
    AppContext.config = loadConfig();

    const message = AppContext.translate('Profile deleted successfully.');
    AppContext.win.webContents.send('show-toast', message);
    dialog.showMessageBoxSync(AppContext.win, {
      type: 'info',
      buttons: ['OK'],
      title: AppContext.translate('Delete Complete'),
      message
    });

    AppContext.reloadServers();
  },

  resetProfile(AppContext) {
    const profileName = typeof AppContext.config.profile === 'string' && AppContext.config.profile.trim() && AppContext.config.profile.trim() !== 'Default'
      ? AppContext.config.profile.trim()
      : 'Default';

    const response = dialog.showMessageBoxSync(AppContext.win, {
      type: 'question',
      buttons: [AppContext.translate('Cancel'), AppContext.translate('Reset')],
      defaultId: 1,
      cancelId: 0,
      title: AppContext.translate('Confirm Reset'),
      message: AppContext.translate('Reset profile settings to default?'),
      detail: `${AppContext.translate('This will reset all settings for the')} "${profileName}" ${AppContext.translate('profile to application defaults. Other profiles will not be affected. This action cannot be undone.')}`
    });

    if (response !== 1) return;

    AppContext.log(`Resetting settings for profile "${profileName}" to defaults.`);

    if (profileName === 'Default') {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({}, null, 2));
      AppContext.log('Reset config file to defaults at ' + configPath);
    } else {
      const { profilesDir } = require('./configManager');
      const profilePath = path.join(profilesDir, `${profileName}.config.json`);
      fs.writeFileSync(profilePath, JSON.stringify({ profile: profileName }, null, 2));
      AppContext.log('Reset profile file to defaults at ' + profilePath);
    }

    const message = AppContext.translate('Profile settings reset to default.');
    AppContext.win.webContents.send('show-toast', message);
    dialog.showMessageBoxSync(AppContext.win, {
      type: 'info',
      buttons: ['OK'],
      title: AppContext.translate('Reset Complete'),
      message
    });

    AppContext.reloadServers();
  },

  resetPlugins(AppContext) {
    const response = dialog.showMessageBoxSync(AppContext.win, {
      type: 'question',
      buttons: [AppContext.translate('Cancel'), AppContext.translate('Reset')],
      defaultId: 1,
      cancelId: 0,
      title: AppContext.translate('Confirm Reset'),
      message: AppContext.translate('Reset plugins to default?'),
      detail: AppContext.translate('This will remove all installed plugins and restore the bundled defaults. Your settings will not be affected. This action cannot be undone.')
    });

    if (response !== 1) return;

    AppContext.log('Resetting plugins to default.');

    const pluginsPath = path.join(app.getPath('userData'), 'resources', 'plugins');
    if (fs.existsSync(pluginsPath)) {
      fs.rmSync(pluginsPath, { recursive: true, force: true });
      AppContext.log('Deleted plugins folder ' + pluginsPath);
    } else {
      AppContext.log('No plugins folder found at ' + pluginsPath);
    }

    const revelationPath = path.join(app.getPath('userData'), 'resources', 'revelation');
    if (fs.existsSync(revelationPath)) {
      fs.rmSync(revelationPath, { recursive: true, force: true });
      AppContext.log('Deleted revelation folder ' + revelationPath);
    } else {
      AppContext.log('No revelation folder found at ' + revelationPath);
    }

    const message = AppContext.translate('Plugins reset to default.');
    AppContext.win.webContents.send('show-toast', message);
    dialog.showMessageBoxSync(AppContext.win, {
      type: 'info',
      buttons: ['OK'],
      title: AppContext.translate('Reset Complete'),
      message
    });

    AppContext.reloadServers();
  }
};

module.exports = { settingsWindow };
