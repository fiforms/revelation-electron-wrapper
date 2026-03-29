const peerPairingWindow = {
  register(ipcMain, AppContext) {
    AppContext.callbacks['menu:peer-pairing'] = () => this.open(AppContext);
  },
  open(AppContext) {
    const key = AppContext.config.key;
    AppContext.win.loadURL(
      `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/admin/settings.html?key=${key}&tab=peering`
    );
  }
};

module.exports = { peerPairingWindow };
