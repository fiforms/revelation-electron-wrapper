// Presentation Window Module

const { app, BrowserWindow, Menu, shell, screen, powerSaveBlocker } = require('electron');


const presentationWindow = {
    presWindow: null,
    powerSaveBlockerId: null,

    register(ipcMain, AppContext) {

        // Handle opening the main presentation window
        ipcMain.handle('open-presentation', async (_event, slug, mdFile, fullscreen) => {
             return await this.openWindow(AppContext, slug, mdFile, fullscreen);
        });

        ipcMain.handle('close-presentation', () => {
            this.closeWindow();
        });

        ipcMain.handle('toggle-presentation', (_event) => {
            this.togglePresentationWindow();
        });
    },
    async openWindow(AppContext, slug, mdFile = 'presentation.md', fullscreen) {

      const displays = screen.getAllDisplays();
      let targetDisplay = displays[AppContext.config.preferredDisplay]; // pick preferred screen or fallback
      if (targetDisplay === undefined) {
        AppContext.log(`⚠️ Preferred display ${AppContext.config.preferredDisplay} not found, defaulting to primary display`);
        targetDisplay = screen.getPrimaryDisplay();
      }

      // Check if the presentation window already exists
      if (this.presWindow && !this.presWindow.isDestroyed()) {
        this.presWindow.focus();
        AppContext.log('⚠️ Presentation already open — focusing existing window');
        return;
      }

      AppContext.log('Opening presentation on display:', targetDisplay.id);
      AppContext.log(`Display bounds: x=${targetDisplay.bounds.x}, y=${targetDisplay.bounds.y}, width=${targetDisplay.bounds.width}, height=${targetDisplay.bounds.height}`);

      let options = {
          autoHideMenuBar: true,
          webPreferences: {
            preload: AppContext.preload
          }
        };
            
      if (process.env.XDG_SESSION_TYPE === 'wayland' && !AppContext.config.forceX11OnWayland) {
        AppContext.log('⚠️ Wayland session detected, not attempting to set window position/size');
        options = {
          ...options,
          frame: false,
          kiosk: true
        };
      }
      else {
        options = {
          ...options,
          fullscreen: fullscreen,
          x: targetDisplay.bounds.x,
          y: targetDisplay.bounds.y,
          width: targetDisplay.bounds.width,
          height: targetDisplay.bounds.height,
        };
      }

      this.presWindow = new BrowserWindow(options);

      this.presWindow.setMenu(null); // 🚫 Remove the menu bar
      const p_key = AppContext.config.key;
      const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/presentations_${p_key}/${slug}/index.html?p=${mdFile}`;
      AppContext.log(`Opening presentation window: ${url}`);
      this.presWindow.loadURL(url);
      // this.presWindow.webContents.openDevTools()  // Uncomment for debugging

      AppContext.log('Power save blocker started');
      this.powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');

      this.presWindow.on('closed', () => {
        if (this.powerSaveBlockerId !== null && powerSaveBlocker.isStarted(this.powerSaveBlockerId)) {
          powerSaveBlocker.stop(this.powerSaveBlockerId);
          this.powerSaveBlockerId = null;
          AppContext.log('🛑 Power save blocker released');
        }
      });
    },

    togglePresentationWindow() {
        if (this.presWindow) {
            this.presWindow.setFullScreen(!this.presWindow.isFullScreen());
        }
    },

    closeWindow() {
        if (this.presWindow && !this.presWindow.isDestroyed()) {
            this.presWindow.close();
        }
    }
}

module.exports = { presentationWindow };
