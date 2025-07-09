const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const kill = require('tree-kill'); // Works on Windows + fallback

let win;
let viteProc = null;
let remoteProc = null;

const isWindows = os.platform() === 'win32';

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

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  waitForServer('http://localhost:8000')
    .then(() => {
      console.log('✅ Server is ready, loading app...');
      win.loadURL('http://localhost:8000');
    })
    .catch(err => {
      console.error('❌ Failed to detect server startup:', err.message);
      win.loadURL('data:text/html,<h1>Server did not start</h1><p>Check logs or reinstall dependencies.</p>');
    });
}

app.whenReady().then(() => {
  const projectDir = path.join(__dirname, 'revelation');

  const spawnOpts = {
    cwd: projectDir,
    shell: true,
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: !isWindows, // Use process groups only on Unix
  };

  // Start Vite
  viteProc = spawn('npx', ['vite', '--host'], spawnOpts);

  // Start reveal.js-remote server
  remoteProc = spawn('node', [
    'node_modules/reveal.js-remote/server/index.js',
    '--port', '1947',
    '--origin', '*',
    '--basepath', '/',
    '--presentationpath', './presentations/'
  ], spawnOpts);

  createWindow();
});

app.on('before-quit', () => {
  console.log('🛑 Cleaning up server processes...');

  const tryKill = (proc, name) => {
    if (!proc || !proc.pid) return;

    if (isWindows) {
      kill(proc.pid, 'SIGTERM', (err) => {
        if (err) console.warn(`⚠️ Failed to kill ${name} (Windows):`, err.message);
        else console.log(`✅ ${name} terminated (Windows)`);
      });
    } else {
      try {
        console.log(`🧨 Force killing ${name} process group (Unix):`, -proc.pid);
        process.kill(-proc.pid, 'SIGTERM');
      } catch (e) {
        console.warn(`⚠️ Failed to kill ${name} (Unix):`, e.message);
      }
    }
  };

  tryKill(viteProc, 'Vite');
  tryKill(remoteProc, 'Remote server');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

