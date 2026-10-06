// Despite the name this opens no window of its own: menu:peer-pairing navigates the MAIN window
// (AppContext.win.loadURL) to /admin/settings.html?tab=peering. Required by main.js; registers no IPC.
// (The pairing IPC handlers live in otherEventHandlers.js, the logic in peerPairing.js.)

const { buildServerURL } = require('./serverUrl');

const peerPairingWindow = {
  register(ipcMain, AppContext) {
    AppContext.callbacks['menu:peer-pairing'] = () => this.open(AppContext);
  },
  open(AppContext) {
    const key = AppContext.config.key;
    const url = buildServerURL(AppContext.hostURL, AppContext.config.viteServerPort, AppContext.config.httpsEnabled);
    AppContext.win.loadURL(`${url}/admin/settings.html?key=${key}&tab=peering`);
  }
};

module.exports = { peerPairingWindow };
