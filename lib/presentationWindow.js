// Presentation Window Module

const { app, BrowserWindow, Menu, shell } = require('electron');

const presentationWindow = {
    register(ipcMain, AppContext) {

        // Handle opening the main presentation window
        ipcMain.handle('open-presentation', async (_event, slug, mdFile, fullscreen) => {
             return await this.openWindow(AppContext, slug, mdFile, fullscreen);
        });

        ipcMain.handle('toggle-presentation', (_event) => {
            this.togglePresentationWindow(AppContext);
        });
    },
    openWindow(AppContext, slug, mdFile = 'presentation.md', fullscreen) {
      AppContext.presWindow = new BrowserWindow({
        fullscreen: fullscreen,
        autoHideMenuBar: true,
        webPreferences: {
          preload: AppContext.preload
        }
      });
    
      AppContext.presWindow.setMenu(null); // 🚫 Remove the menu bar
      const key = AppContext.getPresentationKey();
      const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/presentations_${key}/${slug}/index.html?p=${mdFile}`;
      AppContext.presWindow.loadURL(url);
    },
    togglePresentationWindow(AppContext) {
        if (AppContext.presWindow) {
            AppContext.presWindow.setFullScreen(!AppContext.presWindow.isFullScreen());
        }
    }
}

module.exports = { presentationWindow };