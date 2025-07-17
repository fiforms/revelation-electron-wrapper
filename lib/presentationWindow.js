// Presentation Window Module

const { app, BrowserWindow, Menu, shell, screen } = require('electron');

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

      const displays = screen.getAllDisplays();
      const targetDisplay = displays[AppContext.config.preferredDisplay] || displays[0]; // pick preferred screen or fallback

      this.presWindow = new BrowserWindow({
        fullscreen: fullscreen,
        x: targetDisplay.bounds.x,
        y: targetDisplay.bounds.y,
        width: targetDisplay.bounds.width,
        height: targetDisplay.bounds.height,
        autoHideMenuBar: true,
        webPreferences: {
          preload: AppContext.preload
        }
      });
    
      this.presWindow.setMenu(null); // 🚫 Remove the menu bar
      const p_url = AppContext.config.presentationsDir;
      const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/${p_url}/${slug}/index.html?p=${mdFile}`;
      this.presWindow.loadURL(url);
    },

    togglePresentationWindow() {
        if (this.presWindow) {
            this.presWindow.setFullScreen(!this.presWindow.isFullScreen());
        }
    }
}

module.exports = { presentationWindow };