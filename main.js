const { app, BrowserWindow, utilityProcess, Menu, shell } = require('electron');
const path = require('path');
const http = require('http');
const os = require('os');

const { ipcMain } = require('electron');
const { createPresentation } = require('./lib/createPresentation');

const isWindows = os.platform() === 'win32';

function openPresentationWindow(slug, mdFile = 'presentation.md') {
	  const presWindow = new BrowserWindow({
		      fullscreen: true,
		      autoHideMenuBar: true,
		      webPreferences: {
			            preload: path.join(__dirname, 'preload.js')
			          }
		    });

	  const url = `http://localhost:${VITE_PORT}/presentations/${slug}/index.html?p=${mdFile}`;
	  presWindow.loadURL(url);
}

let win;
let viteProc = null;
let remoteProc = null;

const VITE_PORT = 8000;
const REVEAL_REMOTE_PORT = 1947;
const REVELATION_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'revelation')
  : path.join(__dirname, 'revelation');

const fs = require('fs');
const logFile = path.join(app.getPath('userData'), 'debug.log');
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

log('🛠 App is starting...');


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
      http.get(url, () => resolve())
        .on('error', () => {
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

function openPresentationWindow(slug, mdFile = 'presentation.md') {
  const presWindow = new BrowserWindow({
    fullscreen: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  presWindow.setMenu(null); // 🚫 Remove the menu bar
  const url = `http://localhost:${VITE_PORT}/presentations/${slug}/index.html?p=${mdFile}`;
  presWindow.loadURL(url);
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
  createWin.loadURL(`http://localhost:${VITE_PORT}/admin/create.html`);
}

const mainTemplate = [
  {
    label: 'File',
    submenu: [
      {
        label: 'New Presentation',
        click: () => createCreateWindow()
      },
      { type: 'separator' },
      { role: 'quit' }
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

  waitForServer(`http://localhost:${VITE_PORT}`)
    .then(() => {
      console.log('✅ Vite server is ready, loading app...');
      win.loadURL(`http://localhost:${VITE_PORT}/presentations.html`);
    })
    .catch((err) => {
      console.error('❌ Vite server did not start in time:', err.message);
      win.loadURL(`data:text/html,<h1>Server did not start</h1><pre>${err.message}</pre>`);
    });
}

function startServers() {
  // --- Start Vite ---
  const viteScript = path.join(REVELATION_DIR, 'node_modules', 'vite', 'bin', 'vite.js');

  viteProc = utilityProcess.fork(viteScript, ['--host', '--port', `${VITE_PORT}`], {
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

ipcMain.handle('create-presentation', async (_event, data) => {
  try {
    const result = createPresentation(data);
    return result;
  } catch (err) {
    throw new Error(err.message); // Sends to renderer via rejected promise
  }
});

ipcMain.handle('open-presentation', (_event, slug, mdFile) => {
  openPresentationWindow(slug, mdFile);
});

app.whenReady().then(() => {
  startServers();
  createWindow();
  Menu.setApplicationMenu(mainMenu); 
});

ipcMain.handle('show-presentation-folder', async (_event, slug) => {
  const folder = path.join(REVELATION_DIR, 'presentations', slug);
  if (fs.existsSync(folder)) {
    shell.openPath(folder); // Opens the folder in file browser
    return { success: true };
  } else {
    return { success: false, error: 'Folder not found' };
  }
});

ipcMain.handle('edit-presentation', async (_event, slug, mdFile = 'presentation.md') => {
  const filePath = path.join(REVELATION_DIR, 'presentations', slug, mdFile);
  if (fs.existsSync(filePath)) {
    return shell.openPath(filePath); // Opens in system default editor
  } else {
    throw new Error(`File not found: ${filePath}`);
  }
});

app.on('before-quit', () => {
  console.log('🧹 Shutting down servers...');
  viteProc?.kill();
  remoteProc?.kill();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

