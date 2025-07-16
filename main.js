const { app, BrowserWindow, utilityProcess, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const os = require('os');
const net = require('net');
const fs = require('fs');

const { createPresentation } = require('./lib/createPresentation');
const { importPresentation } = require('./lib/importPresentation');
const { exportPresentation } = require('./lib/exportPresentation');
const { otherEventHandlers } = require('./lib/otherEventHandlers');
const { presentationWindow } = require('./lib/presentationWindow');
const { aboutWindow } = require('./lib/aboutWindow');

const { main: initPresentations } = require('./revelation/scripts/init-presentations');

const AppContext = {
  win: null,                      // Main application window    
  presWindow: null,               // Presentation window
  viteProc: null,                 // Vite dev server process
  remoteProc: null,               // reveal.js-remote server process
  hostURL: 'localhost',           // Host URL (localhost or LAN IP)
  currentMode: 'localhost',       // 'localhost' or 'network'
  logStream: null,                // Write stream for logging
  preload: null,                  // Preload script path
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

function waitForServer(url, timeout = 10000, interval = 300) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => {
      http.get(url, () => {
        if (AppContext.viteProc) {
          resolve();
        } else {
          reject(new Error('Received response, but AppContext.viteProc is null — likely a conflicting process'));
        }
      }).on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error('Timeout waiting for server to start'));
        } else {
          setTimeout(check, interval);
        }
      });
    };

    check();
  });
}

function getLANAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost'; // fallback
}

function waitForProcessExit(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.killed) return resolve(); // already gone
    proc.once('exit', () => resolve());
  });
}

async function switchMode(mode) {
  if (mode === AppContext.currentMode) return;

  AppContext.log(`🔁 Switching to ${mode} mode...`);
  AppContext.currentMode = mode;

  // Kill and wait for both processes
  const waiters = [];
  if (AppContext.viteProc) {
    AppContext.viteProc.kill();
    waiters.push(waitForProcessExit(AppContext.viteProc));
  }
  if (AppContext.remoteProc) {
    AppContext.remoteProc.kill();
    waiters.push(waitForProcessExit(AppContext.remoteProc));
  }
  await Promise.all(waiters);

  AppContext.viteProc = null;
  AppContext.remoteProc = null;


  if(mode == 'localhost') {
    AppContext.hostURL = 'localhost';
  }
  else {
    AppContext.hostURL = getLANAddress();
  }
  AppContext.log(`🌐 Host set to ${AppContext.hostURL}`);

  startServers(mode);

  if (AppContext.win) {
    AppContext.win.close();
    createMainWindow();     // Relaunch main window
  }
}

const mainTemplate = [
  {
    label: 'File',
    submenu: [
      {
        label: 'New Presentation',
        click: () => sendIpc('menu:new-presentation')
      },
      {
        label: 'Import Presentation (REVELation ZIP)',
        click: () => importPresentation(AppContext)
      },
      { type: 'separator' },
      { role: 'quit' }
    ]
  },
  {
    label: 'Presentation',
    submenu: [
      {
        label: 'Localhost Mode',
        type: 'radio',
        checked: AppContext.currentMode === 'localhost',
        click: () => switchMode('localhost')
      },
      {
        label: 'Network Mode',
        type: 'radio',
        checked: AppContext.currentMode === 'network',
        click: () => switchMode('network')
      }
    ]
  },
  {
    label: 'Help',
    submenu: [
      {
	label: 'About...',
	click: () => aboutWindow.open(AppContext)
      }
    ]
  }

];

function sendIpc(channel, ...args) {
  const { BrowserWindow } = require('electron');
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.webContents.send(channel, ...args);
  }
}

const mainMenu = Menu.buildFromTemplate(mainTemplate);

function createMainWindow() {
  AppContext.win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // Optional
    },
  });

  const key = AppContext.getPresentationKey();

  waitForServer(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}`)
    .then(() => {
      AppContext.log('✅ Vite server is ready, loading app...');
      AppContext.win.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/presentations.html?key=${key}`);
    })
    .catch((err) => {
      AppContext.error('❌ Vite server did not start in time:', err.message);
      AppContext.win.loadURL(`data:text/html,<h1>Server did not start</h1><pre>${err.message}</pre>`);
    });
}  // createMainWindow

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', function () {
        tester.close(() => resolve(true));
      })
      .listen(port);
  });
}  // isPortAvailable

async function startServers(mode = 'localhost') {
  // Test for port availability

  const vitePortAvailable = await isPortAvailable(AppContext.config.viteServerPort);
  const remotePortAvailable = await isPortAvailable(AppContext.config.revealRemoteServerPort);

  if (!vitePortAvailable) {
    AppContext.error(`❌ Port ${AppContext.config.viteServerPort} is already in use. Please close the process or change the port.`);
    AppContext.loadURL(`data:text/html,<h1>Port ${AppContext.config.viteServerPort} is already in use. Please close the process or change the port.</h1>`);
    return;
  }

  if (!remotePortAvailable) {
    AppContext.error(`❌ Port ${AppContext.config.revealRemoteServerPort} is already in use. Please close the process or change the port.`);
    AppContext.win.loadURL(`data:text/html,<h1>Port ${AppContext.config.revealRemoteServerPort} is already in use. Please close the process or change the port.</h1>`);
    return;
  }

  // --- Start Vite ---
  const viteScript = path.join(AppContext.config.revelationDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const args = ['--port', `${AppContext.config.viteServerPort}`];
  if (mode === 'network') args.unshift('--host');

  AppContext.viteProc = utilityProcess.fork(viteScript, args, {
    cwd: AppContext.config.revelationDir,
    stdio: 'pipe',
    serviceName: 'Vite Dev Server',
  });

  AppContext.log('📦 Launching Vite:', viteScript);

  AppContext.viteProc.on('spawn', () => AppContext.log('🚀 Vite server started'));
  AppContext.viteProc.on('exit', (code) => AppContext.log(`🛑 Vite server exited (code ${code})`));
  AppContext.viteProc.on('error', (err) => AppContext.error('💥 Vite process error:', err));
  AppContext.viteProc.stdout?.on('data', (data) => AppContext.log(`[VITE STDOUT] ${data.toString().trim()}`));
  AppContext.viteProc.stderr?.on('data', (data) => AppContext.error(`[VITE STDERR] ${data.toString().trim()}`));

  // --- Start Reveal.js Remote Server ---
  if (mode === 'network') {

  const remoteScript = path.join(AppContext.config.revelationDir, 'node_modules', 'reveal.js-remote', 'server', 'index.js');

  AppContext.remoteProc = utilityProcess.fork(remoteScript, [
    '--port', `${AppContext.config.revealRemoteServerPort}`,
    '--origin', '*',
    '--basepath', '/',
    '--presentationpath', './presentations/',
  ], {
    cwd: AppContext.config.revelationDir,
    stdio: 'pipe',
    serviceName: 'Reveal Remote Server',
  });

  AppContext.remoteProc.on('spawn', () => AppContext.log('🚀 Reveal Remote server started'));
  AppContext.remoteProc.on('exit', (code) => AppContext.log(`🛑 Remote server exited (code ${code})`));
  AppContext.remoteProc.on('error', (err) => AppContext.error('💥 Remote server process error:', err));
  AppContext.remoteProc.stdout?.on('data', (data) => AppContext.log(`[REMOTE STDOUT] ${data.toString().trim()}`));
  AppContext.remoteProc.stderr?.on('data', (data) => AppContext.error(`[REMOTE STDERR] ${data.toString().trim()}`));
  }
}  // startServers

app.whenReady().then(() => {
  startServers();
  createMainWindow();
  Menu.setApplicationMenu(mainMenu); 
});

app.on('before-quit', () => {
  AppContext.log('🧹 Shutting down servers...');
  AppContext.viteProc?.kill();
  AppContext.remoteProc?.kill();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

