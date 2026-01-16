const { BrowserWindow } = require('electron');

const peerPairingWindow = {
  register(ipcMain, AppContext) {
    AppContext.callbacks['menu:peer-pairing'] = () => this.open(AppContext);
  },
  open(AppContext) {
    const pairingWin = new BrowserWindow({
      width: 700,
      height: 600,
      webPreferences: {
        preload: AppContext.preload
      }
    });
    pairingWin.setMenu(null);
    const key = AppContext.config.key;
    pairingWin.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/admin/peer-pairing.html?key=${key}`);
  }
};

module.exports = { peerPairingWindow };
