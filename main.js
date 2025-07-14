const { app, BrowserWindow, utilityProcess, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const os = require('os');
const net = require('net');

const { createPresentation } = require('./lib/createPresentation');
const { importPresentation } = require('./lib/importPresentation');
const { exportPresentation } = require('./lib/exportPresentation');

const { main: initPresentations } = require('./revelation/scripts/init-presentations');
initPresentations();

const isWindows = os.platform() === 'win32';

let win;
let viteProc = null;
let remoteProc = null;
let currentMode = 'localhost';
let host_url = 'localhost';
let presWindow = null;

const VITE_PORT = 8000;
const REVEAL_REMOTE_PORT = 1947;
const REVELATION_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'revelation')
  : path.join(__dirname, 'revelation');

const fs = require('fs');
const logFile = path.join(app.getPath('userData'), 'debug.log');
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

log('🛠 App is starting...');

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
  logStream.write(msg);
}

function error(...args) {
  const msg = `[${timestamp()}] ERROR: ${args.join(' ')}\n`;
  console.error(...args);
  logStream.write(msg);
}

function waitForServer(url, timeout = 10000, interval = 300) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => {
      http.get(url, () => {
        if (viteProc) {
          resolve();
        } else {
          reject(new Error('Received response, but viteProc is null — likely a conflicting process'));
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
  const baseDir = REVELATION_DIR;
  const prefix = 'presentations_';
  const match = fs.readdirSync(baseDir).find(name =>
    fs.statSync(path.join(baseDir, name)).isDirectory() && name.startsWith(prefix)
  );
  if (!match) throw new Error('No presentations_<key> folder found');
  return match.replace(prefix, '');
}


function openPresentationWindow(slug, mdFile = 'presentation.md', fullscreen) {
  presWindow = new BrowserWindow({
    fullscreen: fullscreen,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  presWindow.setMenu(null); // 🚫 Remove the menu bar
  const key = getPresentationKey();
  const url = `http://${host_url}:${VITE_PORT}/presentations_${key}/${slug}/index.html?p=${mdFile}`;
  presWindow.loadURL(url);
}

function togglePresentationWindow() {
  if (presWindow) {
    presWindow.setFullScreen(!presWindow.isFullScreen());
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
  createWin.loadURL(`http://${host_url}:${VITE_PORT}/admin/create.html`);
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
  createWin.loadURL(`http://${host_url}:${VITE_PORT}/about.html`);
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
  if (mode === currentMode) return;

  log(`🔁 Switching to ${mode} mode...`);
  currentMode = mode;

  // Kill and wait for both processes
  const waiters = [];
  if (viteProc) {
    viteProc.kill();
    waiters.push(waitForProcessExit(viteProc));
  }
  if (remoteProc) {
    remoteProc.kill();
    waiters.push(waitForProcessExit(remoteProc));
  }
  await Promise.all(waiters);

  viteProc = null;
  remoteProc = null;


  if(mode == 'localhost') {
    host_url = 'localhost';
  }
  else {
    host_url = getLANAddress();
  }
  log(`🌐 Host set to ${host_url}`);

  startServers(mode);

  if (win) {
    win.close();
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
        click: () => importPresentation(REVELATION_DIR + '/presentations_' + getPresentationKey(), log, error)
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
        checked: currentMode === 'localhost',
        click: () => switchMode('localhost')
      },
      {
        label: 'Network Mode',
        type: 'radio',
        checked: currentMode === 'network',
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
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // Optional
    },
  });

  const key = getPresentationKey();

  waitForServer(`http://${host_url}:${VITE_PORT}`)
    .then(() => {
      console.log('✅ Vite server is ready, loading app...');
      win.loadURL(`http://${host_url}:${VITE_PORT}/presentations.html?key=${key}`);
    })
    .catch((err) => {
      error('❌ Vite server did not start in time:', err.message);
      showErrorModal('Vite Server','VITE Server did not start');
      win.loadURL(`data:text/html,<h1>Server did not start</h1><pre>${err.message}</pre>`);
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

  const vitePortAvailable = await isPortAvailable(VITE_PORT);
  const remotePortAvailable = await isPortAvailable(REVEAL_REMOTE_PORT);

  if (!vitePortAvailable) {
    error(`❌ Port ${VITE_PORT} is already in use. Please close the process or change the port.`);
    win.loadURL(`data:text/html,<h1>Port ${VITE_PORT} is already in use. Please close the process or change the port.</h1>`);
    return;
  }

  if (!remotePortAvailable) {
    error(`❌ Port ${REVEAL_REMOTE_PORT} is already in use. Please close the process or change the port.`);
    win.loadURL(`data:text/html,<h1>Port ${REVEAL_REMOTE_PORT} is already in use. Please close the process or change the port.</h1>`);
    return;
  }

  // --- Start Vite ---
  const viteScript = path.join(REVELATION_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  const args = ['--port', `${VITE_PORT}`];
  if (mode === 'network') args.unshift('--host');

  viteProc = utilityProcess.fork(viteScript, args, {
    cwd: REVELATION_DIR,
    stdio: 'pipe',
    serviceName: 'Vite Dev Server',
  });

  log('📦 Launching Vite:', viteScript);

  viteProc.on('spawn', () => log('🚀 Vite server started'));
  viteProc.on('exit', (code) => log(`🛑 Vite server exited (code ${code})`));
  viteProc.on('error', (err) => error('💥 Vite process error:', err));
  viteProc.stdout?.on('data', (data) => log(`[VITE STDOUT] ${data.toString().trim()}`));
  viteProc.stderr?.on('data', (data) => error(`[VITE STDERR] ${data.toString().trim()}`));

  // --- Start Reveal.js Remote Server ---
  if (mode === 'network') {

  const remoteScript = path.join(REVELATION_DIR, 'node_modules', 'reveal.js-remote', 'server', 'index.js');

  remoteProc = utilityProcess.fork(remoteScript, [
    '--port', `${REVEAL_REMOTE_PORT}`,
    '--origin', '*',
    '--basepath', '/',
    '--presentationpath', './presentations/',
  ], {
    cwd: REVELATION_DIR,
    stdio: 'pipe',
    serviceName: 'Reveal Remote Server',
  });

  remoteProc.on('spawn', () => log('🚀 Reveal Remote server started'));
  remoteProc.on('exit', (code) => log(`🛑 Remote server exited (code ${code})`));
  remoteProc.on('error', (err) => error('💥 Remote server process error:', err));
  remoteProc.stdout?.on('data', (data) => log(`[REMOTE STDOUT] ${data.toString().trim()}`));
  remoteProc.stderr?.on('data', (data) => error(`[REMOTE STDERR] ${data.toString().trim()}`));
  }
}

ipcMain.on('open-external-url', (_event, href) => {
  console.log('[main] Opening external URL:', href);
  shell.openExternal(href);
});

ipcMain.handle('create-presentation', async (_event, data) => {
  const key = getPresentationKey();
  try {
    const result = createPresentation(data, REVELATION_DIR + '/presentations_' + key);
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
  const folder = path.join(REVELATION_DIR, 'presentations_' + key, slug);
  if (fs.existsSync(folder)) {
    shell.openPath(folder); // Opens the folder in file browser
    return { success: true };
  } else {
    return { success: false, error: 'Folder not found' };
  }
});

ipcMain.handle('edit-presentation', async (_event, slug, mdFile = 'presentation.md') => {
  const key = getPresentationKey();
  const filePath = path.join(REVELATION_DIR, 'presentations_' + key, slug, mdFile);
  if (fs.existsSync(filePath)) {
    return shell.openPath(filePath); // Opens in system default editor
  } else {
    throw new Error(`File not found: ${filePath}`);
  }
});

ipcMain.handle('export-presentation', async (_event, slug) => {
  const key = getPresentationKey();
  const folderPath = path.join(REVELATION_DIR, 'presentations_' + key, slug);
  return await exportPresentation(folderPath, slug);
});


app.on('before-quit', () => {
  console.log('🧹 Shutting down servers...');
  viteProc?.kill();
  remoteProc?.kill();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

