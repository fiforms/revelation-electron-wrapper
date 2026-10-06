/**
 * firstRunWizard.js -- the first-run language + setup window and its IPC.
 *
 * Shown on the first launch (no config.json yet, or config.firstRunCompleted !== true) before the servers
 * start. Window: preload_first_run.js (`firstRunAPI`), loads http_admin/first-run-language.html.
 * Choosing a different language relaunches the app (app.relaunch) so the menu and UI pick it up.
 *
 * Exports: register(ipcMain, AppContext), maybeShowPrompt(AppContext, { hadConfigAtStartup }),
 *   consumeOpenPluginSettingsRequest(), FIRST_RUN_PLUGIN_SETTINGS_FLAG.
 * IPC owned: first-run:get-state, first-run:open-link, first-run:complete, first-run:cancel
 *   (first-run:install-poppler lives in lib/popplerInstaller.js). Internal ipcMain.emit of
 *   'first-run:startup-complete' tells maybeShowPrompt whether startup may continue.
 * Callers: main.js (register, prompt during app.whenReady, and the plugin-settings hand-off to createMainWindow).
 * Gotcha: the "open Settings -> Plugins afterwards" request survives a language relaunch as the
 *   FIRST_RUN_PLUGIN_SETTINGS_FLAG command-line flag.
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { saveConfig } = require('./configManager');
const { splashWindow } = require('./splashWindow');
const popplerInstaller = require('./popplerInstaller');
const { getPopplerPluginDownload } = require('./popplerRelease');

// One-shot flag: the first-run setup asked to open Settings -> Plugins, but the
// app had to relaunch to apply a language change first.
const FIRST_RUN_PLUGIN_SETTINGS_FLAG = '--first-run-plugin-settings';

// Links the first-run setup page may open in the system browser.
const FIRST_RUN_LINKS = {
  releases: 'https://github.com/fiforms/revelation-electron-wrapper/releases',
  libreoffice: 'https://www.libreoffice.org/download/download-libreoffice/',
  homebrew: 'https://brew.sh/'
};

let firstRunWindow = null;
let openPluginSettingsAfterStartup = process.argv.includes(FIRST_RUN_PLUGIN_SETTINGS_FLAG);

// True once if the setup (or the relaunch flag) asked to land on Settings -> Plugins; clears itself.
function consumeOpenPluginSettingsRequest() {
  const requested = openPluginSettingsAfterStartup;
  openPluginSettingsAfterStartup = false;
  return requested;
}

function createFirstRunWindow() {
  const htmlPath = app.isPackaged
    ? path.join(process.resourcesPath, 'http_admin', 'first-run-language.html')
    : path.join(__dirname, '..', 'http_admin', 'first-run-language.html');
  const iconPath = path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

  firstRunWindow = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 680,
    minHeight: 520,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#0c162a',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload_first_run.js')
    }
  });

  firstRunWindow.on('closed', () => {
    firstRunWindow = null;
  });

  firstRunWindow.loadFile(htmlPath);
}

// Resolves true when startup should continue, false when the app is relaunching or the window was closed.
function maybeShowPrompt(AppContext, { hadConfigAtStartup }) {
  return new Promise((resolve) => {
    const shouldShowFirstRun = !hadConfigAtStartup || AppContext.config.firstRunCompleted !== true;
    if (!shouldShowFirstRun) {
      resolve(true);
      return;
    }

    splashWindow.hide();
    createFirstRunWindow();

    if (!firstRunWindow) {
      resolve(true);
      return;
    }

    let resolved = false;
    const finish = (shouldContinue) => {
      if (resolved) return;
      resolved = true;
      resolve(shouldContinue);
    };

    firstRunWindow.once('closed', () => {
      finish(false);
    });

    ipcMain.once('first-run:startup-complete', (_event, payload = {}) => {
      finish(!payload.relaunching);
    });
  });
}

function register(ipcMain, AppContext) {
  popplerInstaller.register(ipcMain, AppContext);

  ipcMain.handle('first-run:get-state', () => {
    const availableLanguages = Array.from(
      new Set(['en', ...Object.keys(AppContext.translations || {})])
    ).sort();
    const defaultLanguage = String(AppContext.config.language || 'en').trim().toLowerCase() || 'en';
    return {
      availableLanguages,
      defaultLanguage,
      platform: process.platform,
      translations: AppContext.translations || {},
      popplerDownloadAvailable: !!getPopplerPluginDownload(),
      popplerPluginInstalled: popplerInstaller.isPayloadInstalled(AppContext)
        && Array.isArray(AppContext.config.plugins)
        && AppContext.config.plugins.includes('popplerpdf')
    };
  });

  ipcMain.handle('first-run:open-link', (_event, payload = {}) => {
    const url = FIRST_RUN_LINKS[payload.link];
    if (!url) return { success: false };
    shell.openExternal(url).catch((err) => {
      AppContext.error('Failed to open external URL:', err.message);
    });
    return { success: true };
  });

  ipcMain.handle('first-run:complete', (event, payload = {}) => {
    const selectedLanguage = String(payload.language || 'en').trim().toLowerCase() || 'en';
    const previousLanguage = String(AppContext.config.language || 'en').trim().toLowerCase() || 'en';
    const openPluginSettings = payload.openPluginSettings === true;
    AppContext.config.language = selectedLanguage;
    AppContext.config.firstRunCompleted = true;
    saveConfig(AppContext.config);

    const relaunching = selectedLanguage !== previousLanguage;
    if (openPluginSettings && !relaunching) {
      openPluginSettingsAfterStartup = true;
    }
    ipcMain.emit('first-run:startup-complete', event, { relaunching });

    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.close();
    }

    if (relaunching) {
      const args = process.argv.slice(1).filter((arg) => arg !== FIRST_RUN_PLUGIN_SETTINGS_FLAG);
      if (openPluginSettings) args.push(FIRST_RUN_PLUGIN_SETTINGS_FLAG);
      app.relaunch({ args });
      app.exit(0);
    }

    return { success: true, relaunching };
  });

  ipcMain.handle('first-run:cancel', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.close();
    }
    return { success: true };
  });
}

module.exports = {
  register,
  maybeShowPrompt,
  consumeOpenPluginSettingsRequest,
  FIRST_RUN_PLUGIN_SETTINGS_FLAG
};
