// Presentation Window Module

const { app, BrowserWindow, Menu, shell } = require('electron');

const presentationWindow = {
    presWindow: null,

    register(ipcMain, AppContext) {

        // Handle opening the main presentation window
        ipcMain.handle('open-presentation', async (_event, slug, mdFile, fullscreen) => {
             return await this.openWindow(AppContext, slug, mdFile, fullscreen);
        });

        ipcMain.handle('toggle-presentation', (_event) => {
            this.togglePresentationWindow();
        });
    },
    openWindow(AppContext, slug, mdFile = 'presentation.md', fullscreen) {
      this.presWindow = new BrowserWindow({
        fullscreen: fullscreen,
        autoHideMenuBar: true,
        webPreferences: {
          preload: AppContext.preload
        }
      });
    
      this.presWindow.setMenu(null); // 🚫 Remove the menu bar
      const key = AppContext.getPresentationKey();
      const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/presentations_${key}/${slug}/index.html?p=${mdFile}`;
      this.presWindow.loadURL(url);
    },

    togglePresentationWindow() {
        if (this.presWindow) {
            this.presWindow.setFullScreen(!this.presWindow.isFullScreen());
        }
    }
}

module.exports = { presentationWindow };