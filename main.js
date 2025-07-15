const { app, BrowserWindow, utilityProcess, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const os = require('os');
const net = require('net');
const fs = require('fs');

const { createPresentation } = require('./lib/createPresentation');
const { importPresentation } = require('./lib/importPresentation');
const { exportPresentation } = require('./lib/exportPresentation');
const { main: initPresentations } = require('./revelation/scripts/init-presentations');

const AppContext = {
  win: null,                      // Main application window    
  presWindow: null,               // Presentation window
  viteProc: null,                 // Vite dev server process
  remoteProc: null,               // reveal.js-remote server process
  hostURL: 'localhost',           // Host URL (localhost or LAN IP)
  currentMode: 'localhost',       // 'localhost' or 'network'
  logStream: null,                // Write stream for logging
  config: {
    revelationDir: null,          // Path to REVELation installation
    logFile: null,                // Path to log file
    viteServerPort: 8000,         // Default port for Vite dev server
    revealRemoteServerPort: 1947, // Default port for reveal.js-remote
  }
}

AppContext.config.revelationDir = 
    app.isPackaged
      ? path.join(process.resourcesPath, 'revelation')
      : path.join(__dirname, 'revelation');
  
AppContext.config.logFile = path.join(app.getPath('userData'), 'debug.log');
AppContext.logStream = fs.createWriteStream(AppContext.config.logFile, { flags: 'a' });

log('🛠 App is starting...');
initPresentations(AppContext.config.revelationDir);

// Error Modal Helper Function
function showErrorModal(title, message) {
  dialog.showMessageBox({
    type: 'error',
    title: title,
    message: message,
    buttons: ['OK'],
  });
}


// Timestamp helper
function timestamp() {
  return new Date().toISOString();
}

// Dual log functions
function log(...args) {
  const msg = `[${timestamp()}] ${args.join(' ')}\n`;
  console.log(...args);
  AppContext.logStream.write(msg);
}

function error(...args) {
  const msg = `[${timestamp()}] ERROR: ${args.join(' ')}\n`;
  console.error(...args);
  AppContext.logStream.write(msg);
}

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

function getPresentationKey() {
  const baseDir = AppContext.config.revelationDir;
  const prefix = 'presentations_';
  const match = fs.readdirSync(baseDir).find(name =>
    fs.statSync(path.join(baseDir, name)).isDirectory() && name.startsWith(prefix)
  );
  if (!match) throw new Error('No presentations_<key> folder found');
  return match.replace(prefix, '');
}


function openPresentationWindow(slug, mdFile = 'presentation.md', fullscreen) {
  AppContext.presWindow = new BrowserWindow({
    fullscreen: fullscreen,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  AppContext.presWindow.setMenu(null); // 🚫 Remove the menu bar
  const key = getPresentationKey();
  const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/presentations_${key}/${slug}/index.html?p=${mdFile}`;
  AppContext.presWindow.loadURL(url);
}

function togglePresentationWindow() {
  if (AppContext.presWindow) {
    AppContext.presWindow.setFullScreen(!AppContext.presWindow.isFullScreen());
  }
}

function createCreateWindow() {
  const createWin = new BrowserWindow({
    width: 600,
    height: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  createWin.setMenu(null); // 🚫 Remove the menu bar
  createWin.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/admin/create.html`);
}

function createAboutWindow() {
  const createWin = new BrowserWindow({
    width: 600,
    height: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  createWin.setMenu(null); // 🚫 Remove the menu bar
  createWin.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/about.html`);
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

  log(`🔁 Switching to ${mode} mode...`);
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
  log(`🌐 Host set to ${AppContext.hostURL}`);

  startServers(mode);

  if (AppContext.win) {
    AppContext.win.close();
    createWindow();  // Relaunch main window
  }
}

const mainTemplate = [
  {
    label: 'File',
    submenu: [
      {
        label: 'New Presentation',
        click: () => createCreateWindow()
      },
      {
        label: 'Import Presentation (REVELation ZIP)',
        click: () => importPresentation(AppContext.config.revelationDir + '/presentations_' + getPresentationKey(), log, error)
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
	click: () => createAboutWindow()
      }
    ]
  }

];

const mainMenu = Menu.buildFromTemplate(mainTemplate);


function createWindow() {
  AppContext.win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // Optional
    },
  });

  const key = getPresentationKey();

  waitForServer(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}`)
    .then(() => {
      console.log('✅ Vite server is ready, loading app...');
      AppContext.win.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/presentations.html?key=${key}`);
    })
    .catch((err) => {
      error('❌ Vite server did not start in time:', err.message);
      showErrorModal('Vite Server','VITE Server did not start');
      AppContext.win.loadURL(`data:text/html,<h1>Server did not start</h1><pre>${err.message}</pre>`);
    });
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', function () {
        tester.close(() => resolve(true));
      })
      .listen(port);
  });
}

async function startServers(mode = 'localhost') {
  // Test for port availability

  const vitePortAvailable = await isPortAvailable(AppContext.config.viteServerPort);
  const remotePortAvailable = await isPortAvailable(AppContext.config.revealRemoteServerPort);

  if (!vitePortAvailable) {
    error(`❌ Port ${AppContext.config.viteServerPort} is already in use. Please close the process or change the port.`);
    AppContext.loadURL(`data:text/html,<h1>Port ${AppContext.config.viteServerPort} is already in use. Please close the process or change the port.</h1>`);
    return;
  }

  if (!remotePortAvailable) {
    error(`❌ Port ${AppContext.config.revealRemoteServerPort} is already in use. Please close the process or change the port.`);
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

  log('📦 Launching Vite:', viteScript);

  AppContext.viteProc.on('spawn', () => log('🚀 Vite server started'));
  AppContext.viteProc.on('exit', (code) => log(`🛑 Vite server exited (code ${code})`));
  AppContext.viteProc.on('error', (err) => error('💥 Vite process error:', err));
  AppContext.viteProc.stdout?.on('data', (data) => log(`[VITE STDOUT] ${data.toString().trim()}`));
  AppContext.viteProc.stderr?.on('data', (data) => error(`[VITE STDERR] ${data.toString().trim()}`));

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

  AppContext.remoteProc.on('spawn', () => log('🚀 Reveal Remote server started'));
  AppContext.remoteProc.on('exit', (code) => log(`🛑 Remote server exited (code ${code})`));
  AppContext.remoteProc.on('error', (err) => error('💥 Remote server process error:', err));
  AppContext.remoteProc.stdout?.on('data', (data) => log(`[REMOTE STDOUT] ${data.toString().trim()}`));
  AppContext.remoteProc.stderr?.on('data', (data) => error(`[REMOTE STDERR] ${data.toString().trim()}`));
  }
}

ipcMain.on('open-external-url', (_event, href) => {
  console.log('[main] Opening external URL:', href);
  shell.openExternal(href);
});

ipcMain.handle('create-presentation', async (_event, data) => {
  const key = getPresentationKey();
  try {
    const result = createPresentation(data, AppContext.config.revelationDir + '/presentations_' + key);
    return result;
  } catch (err) {
    throw new Error(err.message); // Sends to renderer via rejected promise
  }
});

ipcMain.handle('open-presentation', (_event, slug, mdFile, fullscreen) => {
  openPresentationWindow(slug, mdFile, fullscreen);
});

ipcMain.handle('toggle-presentation', (_event) => {
  togglePresentationWindow();
});

app.whenReady().then(() => {
  startServers();
  createWindow();
  Menu.setApplicationMenu(mainMenu); 
});

ipcMain.handle('show-presentation-folder', async (_event, slug) => {
  const key = getPresentationKey();
  const folder = path.join(AppContext.config.revelationDir, 'presentations_' + key, slug);
  if (fs.existsSync(folder)) {
    shell.openPath(folder); // Opens the folder in file browser
    return { success: true };
  } else {
    return { success: false, error: 'Folder not found' };
  }
});

ipcMain.handle('edit-presentation', async (_event, slug, mdFile = 'presentation.md') => {
  const key = getPresentationKey();
  const filePath = path.join(AppContext.config.revelationDir, 'presentations_' + key, slug, mdFile);
  if (fs.existsSync(filePath)) {
    return shell.openPath(filePath); // Opens in system default editor
  } else {
    throw new Error(`File not found: ${filePath}`);
  }
});

ipcMain.handle('export-presentation', async (_event, slug) => {
  const key = getPresentationKey();
  const folderPath = path.join(AppContext.config.revelationDir, 'presentations_' + key, slug);
  return await exportPresentation(folderPath, slug);
});


app.on('before-quit', () => {
  console.log('🧹 Shutting down servers...');
  AppContext.viteProc?.kill();
  AppContext.remoteProc?.kill();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

