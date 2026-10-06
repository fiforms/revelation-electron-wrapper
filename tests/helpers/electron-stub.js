// Minimal stand-in for `require('electron')` so main-process modules can be loaded under plain Node.
// Install with installElectronStub() BEFORE requiring any lib/ module. Nothing here opens a window:
// BrowserWindow and friends are inert classes; app.getPath() points at a throwaway temp directory.
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'revelation-test-userdata-'));

class Inert {
  constructor() { this.webContents = new Proxy({}, { get: () => () => {} }); }
  on() { return this; }
  once() { return this; }
  loadURL() { return Promise.resolve(); }
  isDestroyed() { return true; }
}

const app = {
  isPackaged: false,
  // Like Electron, the directory exists by the time it is asked for.
  getPath: (name) => {
    const dir = path.join(userData, name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  },
  getName: () => 'revelation-test',
  getVersion: () => '0.0.0-test',
  getAppPath: () => path.resolve(__dirname, '..', '..'),
  on() {}, once() {}, whenReady: () => new Promise(() => {}), quit() {}, isReady: () => false,
  commandLine: { appendSwitch() {} },
  dock: undefined
};

const electronStub = {
  app,
  BrowserWindow: Inert,
  ipcMain: { handle() {}, on() {}, once() {}, removeHandler() {}, removeAllListeners() {} },
  ipcRenderer: {},
  contextBridge: { exposeInMainWorld() {} },
  dialog: {}, shell: {}, screen: { getAllDisplays: () => [] }, clipboard: {}, net: {},
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
  powerSaveBlocker: {}, globalShortcut: {}, nativeImage: {}, utilityProcess: {}
};

let installed = false;
function installElectronStub() {
  if (installed) return electronStub;
  installed = true;
  const originalLoad = Module._load;
  Module._load = function patched(request, ...rest) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, ...rest);
  };
  process.on('exit', () => fs.rmSync(userData, { recursive: true, force: true }));
  return electronStub;
}

module.exports = { installElectronStub, electronStub, userData };
