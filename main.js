const { app, BrowserWindow, psMenu, shell, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
const { pdfExport } = require('./lib/pdfExport');
const { handoutWindow } = require('./lib/handoutWindow');
const { mediaLibrary } = require('./lib/mediaLibrary');

const { create } = require('domain');

const AppContext = {
  win: null,                      // Main application window    
  hostURL: null,           // Host URL (localhost or LAN IP)
  logStream: null,                // Write stream for logging
  preload: null,                  // Preload script path
  mainMenuTemplate: [],           // Main application menu
  callbacks: {},                  // Store callback functions for menu actions
  currentMode: null,              // Current server mode (localhost or LAN)
  config: {},
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
  }
}

AppContext.config = loadConfig();
AppContext.currentMode = AppContext.config.mode || 'localhost';
AppContext.logStream = fs.createWriteStream(AppContext.config.logFile, { flags: 'a' });
AppContext.preload = path.join(__dirname, 'preload.js');
AppContext.hostURL = serverManager.getHostURL(AppContext.config.mode);

createPresentation.register(ipcMain, AppContext);
exportPresentation.register(ipcMain, AppContext);
otherEventHandlers.register(ipcMain, AppContext);
presentationWindow.register(ipcMain, AppContext);
importPresentation.register(ipcMain, AppContext);
pdfExport.register(ipcMain, AppContext);
handoutWindow.register(ipcMain, AppContext);
settingsWindow.register(ipcMain, AppContext);
aboutWindow.register(ipcMain, AppContext);
mainMenu.register(ipcMain, AppContext);
mediaLibrary.register(ipcMain, AppContext);


AppContext.callbacks['menu:switch-mode'] = (mode) => {
    serverManager.switchMode(mode, AppContext, () => {
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
    const allWindows = BrowserWindow.getAllWindows();
    const otherOpenWindows = allWindows.filter(win =>
      win !== AppContext.win && !win.isDestroyed()
    );

    if (otherOpenWindows.length > 0) {
      e.preventDefault();
      AppContext.log('🚫 Cannot close main window — other windows still open.');
      
      // Optional: focus one of the open windows
      otherOpenWindows[0].focus();
      AppContext.win.webContents.send('show-toast', 'Close other windows first.');

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
  createMainWindow();
  const mainMenu = Menu.buildFromTemplate(AppContext.mainMenuTemplate);
  Menu.setApplicationMenu(mainMenu); 
});

app.on('before-quit', () => {
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

ipcMain.handle('reload-servers', async () => {
  AppContext.log('Reloading servers...');
  await serverManager.switchMode(AppContext.config.mode, AppContext,  () => {
      if(AppContext.win) {
        AppContext.win.close();
        createMainWindow();  // Relaunch main window
      }
    }, true); // Force reload
  AppContext.log('Servers reloaded successfully');
});