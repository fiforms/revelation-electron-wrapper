// Presentation Window Module

const { app, BrowserWindow, Menu, shell, screen, powerSaveBlocker } = require('electron');


const presentationWindow = {
    presWindow: null,
    notesWindow: null,
    powerSaveBlockerId: null,
    isRemote: false,
    presentationDisplayId: null,

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
    async openWindow(AppContext, slug, mdFile, fullscreen) {

      const isExternal = mdFile === null;
      this.isRemote = isExternal;

      if (isExternal) {
        AppContext.log('Opening external presentation URL:', slug);
      }

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
      this.presentationDisplayId = targetDisplay.id;

      let options = {
          autoHideMenuBar: true,
          webPreferences: {
            preload: isExternal ? null : AppContext.preload
          }
        };

      // Detect command line parameters for --ozone-platform=x11
      const argv = Array.isArray(process.argv) ? process.argv : [];
      const hasOzoneX11 = argv.some((arg, i) =>
        arg === '--ozone-platform=x11' ||
        (arg === '--ozone-platform' && argv[i + 1] === 'x11')
      );
      if (hasOzoneX11) {
        AppContext.log('🖥️  Ozone X11 platform detected, setting window options for X11');
      }
      if (process.env.XDG_SESSION_TYPE === 'wayland' && !hasOzoneX11) {
        AppContext.log('⚠️ Wayland session detected, not attempting to set window position/size');
        AppContext.log('👉 If the presentation window does not appear on the correct screen,');
        AppContext.log('   consider launching with --ozone-platform=x11');
        options = {
          ...options,
          frame: !fullscreen,
          kiosk: fullscreen
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
      this.presWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
        AppContext.log(`Presentation window requested new window: ${url || '(missing url)'}`);
        if (this.isSpeakerNotesRequest(url, frameName)) {
          AppContext.log(`Allowing speaker notes window open (frame: ${frameName || 'n/a'}).`);
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              width: 1200,
              height: 800,
              autoHideMenuBar: false,
              webPreferences: {
                preload: isExternal ? null : AppContext.preload
              }
            }
          };
        }
        if (url) {
          shell.openExternal(url).catch((err) => {
            AppContext.error('Failed to open external link:', err.message);
          });
        }
        AppContext.log(`Blocked in-app window open (frame: ${frameName || 'n/a'}).`);
        return { action: 'deny' };
      });
      this.presWindow.webContents.on('did-create-window', (childWindow, details) => {
        const frameName = details?.frameName || '';
        const url = details?.url || '';
        if (!this.isSpeakerNotesRequest(url, frameName)) {
          return;
        }
        this.notesWindow = childWindow;
        const notesMenu = Menu.buildFromTemplate([
          {
            label: 'Speaker Notes',
            submenu: [
              {
                label: 'Close Notes Window',
                click: () => this.notesWindow?.close()
              }
            ]
          }
        ]);
        this.notesWindow.setMenu(notesMenu);
        this.moveNotesWindowToSecondaryDisplay(AppContext, this.notesWindow);
        AppContext.log(`Managed speaker notes window created (frame: ${frameName || 'n/a'}).`);
        this.notesWindow.on('closed', () => {
          this.notesWindow = null;
          AppContext.log('Speaker notes window closed.');
        });
      });
      const p_key = AppContext.config.key;
      let url;
      if (isExternal) {
        url = slug;
      } else {
        const host = AppContext.hostLANURL || AppContext.hostURL;
        url = `http://${host}:${AppContext.config.viteServerPort}/presentations_${p_key}/${slug}/index.html`;
        const params = new URLSearchParams();
        params.set('p', mdFile);
        if (AppContext.config.preferHighBitrate) {
          params.set('media', 'high');
        }
        url = `${url}?${params.toString()}`;
      }
      AppContext.log(`Opening presentation window: ${url}`);
      this.presWindow.loadURL(url);
      // this.presWindow.webContents.openDevTools()  // Uncomment for debugging

      AppContext.log('Power save blocker started');
      this.powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');

      this.presWindow.on('closed', async () => {
        // Send remote close event to peers
        const { sendPeerCommand } = require('./peerCommandClient'); 
        let shorturl = url.split('?')[0]; // Strip query params

        const command = { type: 'close-presentation', payload: { url: shorturl } };

        AppContext.log(`Presentation window closed, sending command to close on peers: ${url}`);
        const result = await sendPeerCommand(AppContext, command);

        if (this.powerSaveBlockerId !== null && powerSaveBlocker.isStarted(this.powerSaveBlockerId)) {
          powerSaveBlocker.stop(this.powerSaveBlockerId);
          this.powerSaveBlockerId = null;
          AppContext.log('🛑 Power save blocker released');
        }
      });
    },

    isSpeakerNotesRequest(rawUrl, frameName) {
      if (frameName && /notes/i.test(frameName)) {
        return true;
      }
      if (!rawUrl) return false;
      try {
        const parsed = new URL(rawUrl);
        const params = parsed.searchParams;
        if (params.has('notes') || params.has('speaker') || params.has('receiver') || params.has('showNotes')) {
          return true;
        }
        if (parsed.hash && /notes|speaker/i.test(parsed.hash)) {
          return true;
        }
      } catch (err) {
        return /notes|speaker/i.test(rawUrl);
      }
      return /notes|speaker/i.test(rawUrl);
    },

    moveNotesWindowToSecondaryDisplay(AppContext, notesWindow) {
      if (!notesWindow || notesWindow.isDestroyed()) return;
      const displays = screen.getAllDisplays();
      const secondary = displays.find((display) => display.id !== this.presentationDisplayId);
      if (!secondary) {
        AppContext.log('No secondary display available for speaker notes window.');
        return;
      }
      const area = secondary.workArea || secondary.bounds;
      const width = Math.min(1200, area.width);
      const height = Math.min(800, area.height);
      const x = area.x + Math.max(0, Math.floor((area.width - width) / 2));
      const y = area.y + Math.max(0, Math.floor((area.height - height) / 2));
      notesWindow.setBounds({ x, y, width, height });
      AppContext.log(`Moved speaker notes window to display ${secondary.id}.`);
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
