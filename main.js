const { app, BrowserWindow, psMenu, shell, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsExtra = require('fs-extra');
const os = require('os');

ensureWritableResources();

const { createPresentation } = require('./lib/createPresentation');
const { importPresentation } = require('./lib/importPresentation');
const { exportPresentation } = require('./lib/exportPresentation');
const { otherEventHandlers } = require('./lib/otherEventHandlers');
const { presentationWindow } = require('./lib/presentationWindow');
const { aboutWindow } = require('./lib/aboutWindow');
const { mainMenu } = require('./lib/mainMenu');
const { serverManager } = require('./lib/serverManager');
const { loadConfig, saveConfig } = require('./lib/configManager');
const { settingsWindow } = require('./lib/settingsWindow');
const { mdnsManager } = require('./lib/mdnsManager');
const { peerServer } = require('./lib/peerServer');
const { peerPairingWindow } = require('./lib/peerPairingWindow');
const { pdfExport } = require('./lib/pdfExport');
const { handoutWindow } = require('./lib/handoutWindow');
const { mediaLibrary } = require('./lib/mediaLibrary');
const { pluginDirector } = require('./lib/pluginDirector');
const { exportWindow } = require('./lib/exportWindow');

const { create } = require('domain');

const AppContext = {
  win: null,                      // Main application window    
  hostURL: null,           // Host URL (localhost or LAN IP)
  logStream: null,                // Write stream for logging
  preload: null,                  // Preload script path
  mainMenuTemplate: [],           // Main application menu
  callbacks: {},                  // Store callback functions for menu actions
  currentMode: null,              // Current server mode (localhost or LAN)
  plugins: {},                    // Collection of plugin objects
  config: {},
  forceCloseMain: false,          // flag to allow forcing main window to close (for reload)
  translations: {},               // Store translations
  mdnsPeers: [],
  timestamp() {
    return new Date().toISOString();
  },

  log(...args) {
    const msg = `[${this.timestamp()}] ${args.join(' ')}\n`;
    console.log(...args);
    this.logStream?.write(msg);
  },

  error(...args) {
    const msg = `[${this.timestamp()}] ERROR: ${args.join(' ')}\n`;
    console.error(...args);
    this.logStream?.write(msg);
  },

  resetLog() {
    if (AppContext.logStream) {
      AppContext.logStream.end(); // close existing stream
    }

    // Truncate the file to empty it
    fs.writeFileSync(AppContext.config.logFile, '', 'utf8');

    // Reopen the stream in append mode
    AppContext.logStream = fs.createWriteStream(AppContext.config.logFile, { flags: 'a' });

  },

  callback(name, ...args) {
    if (this.callbacks[name]) {
      return this.callbacks[name](...args);
    } else {
      console.warn(`No callback registered for '${name}'`);
    }
  },

  translate(string) {
    // Search for translated string in current language
    const lang = this.config.language || 'en';
    if (this.translations[lang] && this.translations[lang][string]) {
      return this.translations[lang][string];
    }
    // Fallback to English
    if (lang !== 'en') {
      AppContext.log(`Missing translation for '${string}' in language '${lang}', falling back to English.`);
    }
    return string;
  }
}

AppContext.config = loadConfig();
AppContext.currentMode = AppContext.config.mode || 'localhost';
AppContext.logStream = fs.createWriteStream(AppContext.config.logFile, { flags: 'a' });
AppContext.preload = path.join(__dirname, 'preload.js');
AppContext.hostURL = serverManager.getHostURL(AppContext.config.mode);
AppContext.translations = require('./http_admin/locales/translations.json');
console.log(`Loaded ${Object.keys(AppContext.translations).length} translations.`);

app.commandLine.appendSwitch('lang', AppContext.config.language || 'en');

createPresentation.register(ipcMain, AppContext);
exportPresentation.register(ipcMain, AppContext);
otherEventHandlers.register(ipcMain, AppContext);
presentationWindow.register(ipcMain, AppContext);
importPresentation.register(ipcMain, AppContext);
pdfExport.register(ipcMain, AppContext);
handoutWindow.register(ipcMain, AppContext);
settingsWindow.register(ipcMain, AppContext);
peerPairingWindow.register(ipcMain, AppContext);
aboutWindow.register(ipcMain, AppContext);
mainMenu.register(ipcMain, AppContext);
mediaLibrary.register(ipcMain, AppContext);
pluginDirector.register(ipcMain, AppContext);
exportWindow.register(ipcMain, AppContext);


AppContext.callbacks['menu:switch-mode'] = (mode) => {
    serverManager.switchMode(mode, AppContext, () => {
      mdnsManager.refresh(AppContext);
      peerServer.refresh(AppContext);
      if(AppContext.win) {
        AppContext.win.close();
        createMainWindow();  // Relaunch main window
      }
    });
} 

AppContext.callbacks['menu:create-main-window'] = createMainWindow;

function createMainWindow() {

  const isWin = process.platform === 'win32';
  const isLinux = process.platform === 'linux';
  const isMac = process.platform === 'darwin';

  const iconPath = path.join(__dirname, 'assets', 
    isWin ? 'icon.ico' :
    isLinux ? 'icon.png' :
    'icon.png' // fallback for macOS or unknown
  );

  AppContext.log(`Creating main window with icon: ${iconPath}`);

  AppContext.win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // Optional
    },
  });

  // Prevent closing the main window if other windows are open
  AppContext.win.on('close', (e) => {
    if (AppContext.forceCloseMain) return;

    const allWindows = BrowserWindow.getAllWindows();
    const otherOpenWindows = allWindows.filter(win =>
      win !== AppContext.win && !win.isDestroyed()
    );

    if (otherOpenWindows.length > 0) {
      e.preventDefault();
      AppContext.log('🚫 Cannot close main window — other windows still open.');
      
      // Optional: focus one of the open windows
      otherOpenWindows[0].focus();
      AppContext.win.webContents.send('show-toast', AppContext.translate('Close other windows first.'));

    }
  });

  if(serverManager.viteProc) {
    AppContext.log('Vite server is already running, loading main window...');
    const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/presentations.html?key=${AppContext.config.key}`
    AppContext.win.loadURL(url);
    return;
  }

  if(!fs.existsSync(path.join(AppContext.config.presentationsDir))) {
    AppContext.error(`Presentations directory not found: ${AppContext.config.presentationsDir}`);
    dialog.showErrorBox('Error', `Presentations directory not found: ${AppContext.config.presentationsDir}`);
    AppContext.win.loadURL(`data:text/html,<h1>Error</h1><p>Presentations directory not found: ${AppContext.config.presentationsDir}. Try resetting all settings.</p>`);
    return;
  }

  serverManager.waitForServer(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}`)
    .then(() => {
      const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/presentations.html?key=${AppContext.config.key}`
      AppContext.log(`✅ Vite server is ready, loading app at ${url}`);
      AppContext.win.loadURL(url);
      // AppContext.win.webContents.openDevTools()  // Uncomment for debugging
    })
    .catch((err) => {
      AppContext.error('❌ Vite server did not start in time:', err.message);
      AppContext.win.loadURL(`data:text/html,<h1>Server did not start</h1><pre>${err.message}</pre>`);
    });

}  // createMainWindow

// Ensure only one instance of the app is running
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  AppContext.log('🚫 Second instance detected — exiting');
  app.quit();
  return 1;
} else {
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    // Someone tried to run a second instance — focus main window
    if (AppContext.win) {
      if (AppContext.win.isMinimized()) AppContext.win.restore();
      AppContext.win.focus();
      console.log('🔁 Second instance triggered — focusing main window');
    }
  });
}


app.whenReady().then(() => {
  serverManager.startServers(AppContext.config.mode, AppContext);
  mdnsManager.refresh(AppContext);
  peerServer.refresh(AppContext);
  createMainWindow();
  const translatedMenu = translateMenu(AppContext.mainMenuTemplate, AppContext);
  const mainMenu = Menu.buildFromTemplate(translatedMenu);
  Menu.setApplicationMenu(mainMenu); 
});

app.on('before-quit', () => {
  mdnsManager.stop(AppContext);
  peerServer.stop(AppContext);
  serverManager.stopServers(AppContext);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

function translateMenu(menuTemplate, appContext) {
  // Recursively translate menu items
  return menuTemplate.map(item => {
    const newItem = { ...item };
    if (newItem.label) {
      newItem.label = appContext.translate(newItem.label);
    }
    if (newItem.submenu) {
      newItem.submenu = translateMenu(newItem.submenu, appContext);
    }
    return newItem;
  });
}

AppContext.reloadServers = async () => {
  AppContext.log('Reloading servers...');
  AppContext.forceCloseMain = true; 

  await serverManager.switchMode(AppContext.config.mode, AppContext,  () => {
      AppContext.mainMenuTemplate = [];
      mainMenu.register(ipcMain,AppContext);
      pluginDirector.populatePlugins(AppContext);
      pluginDirector.writePluginsIndex(AppContext);
      mdnsManager.refresh(AppContext);
      peerServer.refresh(AppContext);
      if(AppContext.win) {
        AppContext.win.close();
        createMainWindow();  // Relaunch main window
        const translatedMenu = translateMenu(AppContext.mainMenuTemplate, AppContext);
        const mainMenu = Menu.buildFromTemplate(translatedMenu);
        Menu.setApplicationMenu(mainMenu); 
      }
    }, true); // Force reload

  AppContext.forceCloseMain = false;
  AppContext.log('Servers reloaded successfully');
}

function ensureWritableResources() {
  const userDataDir = app.getPath('userData');
  const userResources = path.join(userDataDir, 'resources');
  const userRevelation = path.join(userResources, 'revelation');
  const userPlugins = path.join(userResources, 'plugins');
  const appRevelation = path.join(process.resourcesPath, 'revelation');
  const appPlugins = path.join(process.resourcesPath, 'plugins');
  const appPkg = path.join(appRevelation, 'package.json');
  const userPkg = path.join(userRevelation, 'package.json');

  // If system folder is not writable (typical on Linux /opt)
  let writable = true;
  try {
    fs.accessSync(process.resourcesPath, fs.constants.W_OK);
    console.log(`System resources path is writable: ${process.resourcesPath}`);
  } catch {
    writable = false;
  }

  if (!writable) {
    console.log(`System resources path is not writable: ${process.resourcesPath}`);
    console.log(`Using user resources path: ${userResources}`);
    fs.mkdirSync(userResources, { recursive: true });

    // Copy both revelation and plugins if missing
    if (!fs.existsSync(userRevelation)) {
      fsExtra.copySync(appRevelation, userRevelation, { overwrite: false });
      console.log('📦 Copied revelation to user resources folder.');
    }
    if (!fs.existsSync(userPlugins)) {
      fsExtra.copySync(appPlugins, userPlugins, { overwrite: false });
      console.log('📦 Copied plugins to user resources folder.');
    }

    // 🔄 Check for version update
    if (fs.existsSync(appPkg)) {
      const appVer = JSON.parse(fs.readFileSync(appPkg, 'utf8')).version;
      let userVer = '0.0.0';
      if (fs.existsSync(userPkg)) {
        userVer = JSON.parse(fs.readFileSync(userPkg, 'utf8')).version;
      }

      if (appVer !== userVer) {
        console.log(`🔄 Revelation version changed (${userVer} → ${appVer}), syncing updates...`);
        fsExtra.copySync(appRevelation, userRevelation, { overwrite: true, errorOnExist: false });
        fsExtra.copySync(appPlugins, userPlugins, {
          overwrite: true,
          filter(src, dest) {
            // Don’t overwrite user-added plugins
            if (fs.existsSync(dest) && dest.includes('/plugins/')) return false;
            return true;
          }
        });
        console.log('✅ User resources updated.');
      }
    }

  }

}

ipcMain.handle('reload-servers', AppContext.reloadServers);
