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
