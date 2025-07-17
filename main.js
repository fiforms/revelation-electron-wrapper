const { app, BrowserWindow, psMenu, shell, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const { createPresentation } = require('./lib/createPresentation');
const { importPresentation } = require('./lib/importPresentation');
const { exportPresentation } = require('./lib/exportPresentation');
const { otherEventHandlers } = require('./lib/otherEventHandlers');
const { presentationWindow } = require('./lib/presentationWindow');
const { aboutWindow } = require('./lib/aboutWindow');
const { mainMenu } = require('./lib/mainMenu');
const { serverManager } = require('./lib/serverManager');

const { main: initPresentations, main } = require('./revelation/scripts/init-presentations');

const AppContext = {
  win: null,                      // Main application window    
  hostURL: 'localhost',           // Host URL (localhost or LAN IP)
  logStream: null,                // Write stream for logging
  preload: null,                  // Preload script path
  mainMenuTemplate: [],           // Main application menu
  callbacks: {},                  // Store callback functions for menu actions
  config: {
    revelationDir: null,          // Path to REVELation installation
    logFile: null,                // Path to log file
    viteServerPort: 8000,         // Default port for Vite dev server
    revealRemoteServerPort: 1947, // Default port for reveal.js-remote
  },
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

  getPresentationKey() {
    const baseDir = this.config.revelationDir;
    const prefix = 'presentations_';
    const match = fs.readdirSync(baseDir).find(name =>
      fs.statSync(path.join(baseDir, name)).isDirectory() && name.startsWith(prefix)
    );
    if (!match) throw new Error('No presentations_<key> folder found');
    return match.replace(prefix, '');
  },

  callback(name, ...args) {
    if (this.callbacks[name]) {
      return this.callbacks[name](...args);
    } else {
      console.warn(`No callback registered for '${name}'`);
    }
  }
}

AppContext.config.revelationDir = 
    app.isPackaged
      ? path.join(process.resourcesPath, 'revelation')
      : path.join(__dirname, 'revelation');
  
AppContext.config.logFile = path.join(app.getPath('userData'), 'debug.log');
AppContext.logStream = fs.createWriteStream(AppContext.config.logFile, { flags: 'a' });
AppContext.preload = path.join(__dirname, 'preload.js');

createPresentation.register(ipcMain, AppContext);
exportPresentation.register(ipcMain, AppContext);
otherEventHandlers.register(ipcMain, AppContext);
presentationWindow.register(ipcMain, AppContext);
importPresentation.register(ipcMain, AppContext);
aboutWindow.register(ipcMain, AppContext);
mainMenu.register(ipcMain, AppContext);

AppContext.callbacks['menu:switch-mode'] = (mode) => {
    serverManager.switchMode(mode, AppContext, () => {
      if(AppContext.win) {
        AppContext.win.close();
        createMainWindow();  // Relaunch main window
      }
    });
} 

function createMainWindow() {
  AppContext.win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // Optional
    },
  });

  const key = AppContext.getPresentationKey();

  serverManager.waitForServer(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}`)
    .then(() => {
      AppContext.log('✅ Vite server is ready, loading app...');
      AppContext.win.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/presentations.html?key=${key}`);
    })
    .catch((err) => {
      AppContext.error('❌ Vite server did not start in time:', err.message);
      AppContext.win.loadURL(`data:text/html,<h1>Server did not start</h1><pre>${err.message}</pre>`);
    });
}  // createMainWindow

app.whenReady().then(() => {
  serverManager.startServers('localhost', AppContext);
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

