const { app, BrowserWindow, psMenu, shell, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsExtra = require('fs-extra');
const os = require('os');
const Module = require('module');

ensureWritableResources();
ensureAppNodeModulesOnPath();

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
const { peerPairingWindow } = require('./lib/peerPairingWindow');
const { pdfExport } = require('./lib/pdfExport');
const { handoutWindow } = require('./lib/handoutWindow');
const { mediaLibrary } = require('./lib/mediaLibrary');
const { pluginDirector } = require('./lib/pluginDirector');
const { exportWindow } = require('./lib/exportWindow');
const { peerCommandClient } = require('./lib/peerCommandClient');
const { presentationBuilderWindow } = require('./lib/presentationBuilderWindow');
const { checkForUpdates } = require('./lib/updateChecker');
const { generateDocumentationPresentations } = require('./lib/docsPresentationBuilder');

const { create } = require('domain');

const AppContext = {
  win: null,                      // Main application window    
  hostURL: null,           // Host URL (always localhost for app screens)
  hostLANURL: null,        // Host URL for LAN-accessible presentation URLs
  logStream: null,                // Write stream for logging
  preload: null,                  // Preload script path
  presentationPreload: null,      // Presentation preload script path
  handoutPreload: null,           // Handout preload script path
  mainMenuTemplate: [],           // Main application menu
  callbacks: {},                  // Store callback functions for menu actions
  currentMode: null,              // Current server mode (localhost or LAN)
  plugins: {},                    // Collection of plugin objects
  config: {},
  forceCloseMain: false,          // flag to allow forcing main window to close (for reload)
  translations: {},               // Store translations
  mdnsPeers: [],
  pairedPeerCache: new Map(),
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

    fs.mkdirSync(path.dirname(AppContext.config.logFile), { recursive: true });

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
AppContext.resetLog();
AppContext.preload = path.join(__dirname, 'preload.js');
AppContext.presentationPreload = path.join(__dirname, 'preload_presentation.js');
AppContext.handoutPreload = path.join(__dirname, 'preload_handout.js');
AppContext.hostURL = 'localhost';
AppContext.hostLANURL = serverManager.getHostURL(AppContext.config.mode);
const translationsPath = app.isPackaged
  ? path.join(process.resourcesPath, 'http_admin', 'locales', 'translations.json')
  : path.join(__dirname, 'http_admin', 'locales', 'translations.json');
AppContext.translations = JSON.parse(fs.readFileSync(translationsPath, 'utf8'));
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
presentationBuilderWindow.register(ipcMain, AppContext);


AppContext.callbacks['menu:switch-mode'] = (mode) => {
    serverManager.switchMode(mode, AppContext, () => {
      mdnsManager.refresh(AppContext);
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
    width: 1380,
    height: 820,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // Optional
    },
  });

  AppContext.win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    AppContext.error(`❌ Window failed to load (${errorCode}): ${errorDescription} — ${validatedURL}`);
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

      return;
    }

    if (mediaLibrary.isTranscoding && mediaLibrary.isTranscoding()) {
      const response = dialog.showMessageBoxSync(AppContext.win, {
        type: 'warning',
        buttons: [
          AppContext.translate('Keep Open'),
          AppContext.translate('Quit Anyway')
        ],
        defaultId: 0,
        cancelId: 0,
        title: AppContext.translate('Conversion in progress'),
        message: AppContext.translate('Conversion in progress'),
        detail: AppContext.translate('A high-bitrate video is still converting. Do you want to quit now and stop the conversion?')
      });
      if (response === 0) {
        e.preventDefault();
        return;
      }
      mediaLibrary.stopActiveTranscode?.();
    }
  });

  if (serverManager.viteProc) {
    AppContext.log('Vite server is already running, waiting for it to respond...');
  }

  if(!fs.existsSync(path.join(AppContext.config.presentationsDir))) {
    AppContext.error(`Presentations directory not found: ${AppContext.config.presentationsDir}`);
    dialog.showErrorBox('Error', `Presentations directory not found: ${AppContext.config.presentationsDir}`);
    AppContext.win.loadURL(`data:text/html,<h1>Error</h1><p>Presentations directory not found: ${AppContext.config.presentationsDir}. Try resetting all settings.</p>`);
    return;
  }

  const baseURL = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}`;
  const baseOrigin = new URL(baseURL).origin;
  const isExternalURL = (href) => {
    if (!href) return false;
    try {
      const parsed = new URL(href);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      return parsed.origin !== baseOrigin;
    } catch {
      return false;
    }
  };

  AppContext.win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalURL(url)) {
      shell.openExternal(url).catch((err) => {
        AppContext.error('Failed to open external URL:', err.message);
      });
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  AppContext.win.webContents.on('will-navigate', (event, url) => {
    if (isExternalURL(url)) {
      event.preventDefault();
      shell.openExternal(url).catch((err) => {
        AppContext.error('Failed to open external URL:', err.message);
      });
    }
  });
  AppContext.log(`⏳ Waiting for Vite at ${baseURL}`);
  serverManager.waitForServer(baseURL, 20000)
    .then(() => {
      const url = `${baseURL}/presentations.html?key=${AppContext.config.key}`
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


app.whenReady().then(async () => {
  try {
    const docsResult = generateDocumentationPresentations({
      presentationsDir: AppContext.config.presentationsDir,
      revelationDir: AppContext.config.revelationDir,
      wrapperRoot: __dirname
    });
    AppContext.log(`📝 Documentation presentation ready: ${docsResult.generatedCount} files (${docsResult.readmePresDir})`);
  } catch (err) {
    AppContext.error(`Failed to prepare documentation presentation: ${err.message}`);
  }

  await serverManager.startServers(AppContext.config.mode, AppContext);
  mdnsManager.refresh(AppContext);
  peerCommandClient.start(AppContext);
  createMainWindow();
  const translatedMenu = translateMenu(AppContext.mainMenuTemplate, AppContext);
  const mainMenu = Menu.buildFromTemplate(translatedMenu);
  Menu.setApplicationMenu(mainMenu); 
  setTimeout(() => {
    checkForUpdates(AppContext).catch((err) => {
      AppContext.error('Update check error:', err.message);
    });
  }, 1500);
});

app.on('before-quit', () => {
  mdnsManager.stop(AppContext);
  peerCommandClient.stop();
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
  const syncStatePath = path.join(userResources, '.sync-state.json');

  // If system folder is not writable (typical on Linux /opt)
  let writable = true;
  try {
    fs.accessSync(process.resourcesPath, fs.constants.W_OK);
    console.log(`System resources path is writable: ${process.resourcesPath}`);
  } catch {
    writable = false;
  }

  const hasUserMirror = fs.existsSync(userRevelation) || fs.existsSync(userPlugins);
  const shouldUseUserResources = !writable || hasUserMirror;
  if (!shouldUseUserResources) return;

  if (!writable) {
    console.log(`System resources path is not writable: ${process.resourcesPath}`);
  } else {
    console.log(`System resources path is writable, but existing user resource mirror found.`);
  }
  console.log(`Using user resources path: ${userResources}`);
  fs.mkdirSync(userResources, { recursive: true });

  try {
    if (!fs.existsSync(userRevelation) && fs.existsSync(appRevelation)) {
      fsExtra.copySync(appRevelation, userRevelation, { overwrite: false });
      console.log('📦 Copied revelation to user resources folder.');
    }
    if (!fs.existsSync(userPlugins) && fs.existsSync(appPlugins)) {
      fsExtra.copySync(appPlugins, userPlugins, { overwrite: false });
      console.log('📦 Copied plugins to user resources folder.');
    }

    if (!fs.existsSync(appPkg)) return;

    const syncState = readJsonSafe(syncStatePath) || {};
    const appVer = String((readJsonSafe(appPkg) || {}).version || '').trim();
    if (!appVer) return;

    let userVer = '0.0.0';
    const userPkgJson = readJsonSafe(userPkg);
    if (userPkgJson && typeof userPkgJson.version === 'string' && userPkgJson.version.trim()) {
      userVer = userPkgJson.version.trim();
    } else if (typeof syncState.revelationVersion === 'string' && syncState.revelationVersion.trim()) {
      userVer = syncState.revelationVersion.trim();
    }

    if (appVer !== userVer) {
      console.log(`🔄 Revelation version changed (${userVer} → ${appVer}), syncing updates...`);
      replaceDirectory(appRevelation, userRevelation);
      const bundledEntries = syncBundledPlugins(
        appPlugins,
        userPlugins,
        Array.isArray(syncState.bundledPluginEntries) ? syncState.bundledPluginEntries : []
      );
      writeSyncState(syncStatePath, {
        revelationVersion: appVer,
        bundledPluginEntries: bundledEntries,
        syncedAt: new Date().toISOString()
      });
      console.log('✅ User resources updated.');
      return;
    }

    // Keep sync metadata populated for recovery and future stale-plugin pruning.
    const currentBundledEntries = listEntryNames(appPlugins);
    if (
      !Array.isArray(syncState.bundledPluginEntries) ||
      syncState.revelationVersion !== appVer
    ) {
      writeSyncState(syncStatePath, {
        revelationVersion: appVer,
        bundledPluginEntries: currentBundledEntries,
        syncedAt: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error(`❌ Failed to sync user resources: ${err.message}`);
    console.error('Continuing startup with available resources.');
  }
}

function ensureAppNodeModulesOnPath() {
  const appNodeModules = path.join(app.getAppPath(), 'node_modules');
  if (!fs.existsSync(appNodeModules)) return;

  const existing = process.env.NODE_PATH
    ? process.env.NODE_PATH.split(path.delimiter).filter(Boolean)
    : [];
  if (existing.includes(appNodeModules)) return;

  process.env.NODE_PATH = [...existing, appNodeModules].join(path.delimiter);
  Module._initPaths();
  console.log(`Added app node_modules to NODE_PATH: ${appNodeModules}`);
}

function syncBundledPlugins(appPlugins, userPlugins, previousBundledEntries = []) {
  if (!fs.existsSync(appPlugins)) return [];
  fs.mkdirSync(userPlugins, { recursive: true });

  const bundledEntryNames = listEntryNames(appPlugins);
  const previouslyBundled = new Set(previousBundledEntries);
  const currentlyBundled = new Set(bundledEntryNames);

  // Remove entries that used to be bundled but are no longer bundled now.
  for (const name of previouslyBundled) {
    if (currentlyBundled.has(name)) continue;
    const stalePath = path.join(userPlugins, name);
    if (fs.existsSync(stalePath)) {
      fs.rmSync(stalePath, { recursive: true, force: true });
    }
  }

  // Replace every currently bundled plugin entry while preserving user-only entries.
  for (const name of bundledEntryNames) {
    const srcPath = path.join(appPlugins, name);
    const destPath = path.join(userPlugins, name);

    if (fs.existsSync(destPath)) {
      fs.rmSync(destPath, { recursive: true, force: true });
    }
    fsExtra.copySync(srcPath, destPath, { overwrite: true, errorOnExist: false });
  }

  return bundledEntryNames;
}

function replaceDirectory(sourcePath, destPath) {
  if (!fs.existsSync(sourcePath)) return;
  const tmpPath = `${destPath}.tmp-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (fs.existsSync(tmpPath)) {
    fs.rmSync(tmpPath, { recursive: true, force: true });
  }
  fsExtra.copySync(sourcePath, tmpPath, { overwrite: true, errorOnExist: false });
  if (fs.existsSync(destPath)) {
    fs.rmSync(destPath, { recursive: true, force: true });
  }
  fs.renameSync(tmpPath, destPath);
}

function listEntryNames(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => entry.name);
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeSyncState(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

ipcMain.handle('reload-servers', AppContext.reloadServers);
