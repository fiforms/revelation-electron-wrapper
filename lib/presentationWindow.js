// Presentation Window Module

const { app, BrowserWindow, Menu, shell, screen, powerSaveBlocker } = require('electron');

function applyPresentationOptions(url, config, overrides = {}) {
  try {
    const parsed = new URL(url);
    const requestedLanguage = Object.prototype.hasOwnProperty.call(overrides, 'language')
      ? overrides.language
      : (config.preferredPresentationLanguage || config.language || 'en');
    const requestedVariant = Object.prototype.hasOwnProperty.call(overrides, 'variant')
      ? overrides.variant
      : (config.screenTypeVariant || '');
    const lang = String(requestedLanguage || '').trim().toLowerCase();
    const variant = String(requestedVariant || '').trim().toLowerCase();
    if (lang) {
      parsed.searchParams.set('lang', lang);
    }
    if (variant) {
      parsed.searchParams.set('variant', variant);
    } else {
      parsed.searchParams.delete('variant');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

const presentationWindow = {
    presWindow: null,
    notesWindow: null,
    additionalScreenWindows: [],
    powerSaveBlockerId: null,
    isRemote: false,
    presentationDisplayId: null,
    windowIsExternal: null,

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
      const shouldWrapInPip = !!AppContext.config.pipEnabled;
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

      const p_key = AppContext.config.key;
      let presentationUrl;
      if (isExternal) {
        presentationUrl = applyPresentationOptions(slug, AppContext.config);
      } else {
        const host = AppContext.hostLANURL || AppContext.hostURL;
        presentationUrl = `http://${host}:${AppContext.config.viteServerPort}/presentations_${p_key}/${slug}/index.html`;
        const params = new URLSearchParams();
        params.set('p', mdFile);
        if (AppContext.config.preferHighBitrate) {
          params.set('media', 'high');
        }
        const lang = String(AppContext.config.preferredPresentationLanguage || AppContext.config.language || 'en').trim().toLowerCase();
        const variant = String(AppContext.config.screenTypeVariant || '').trim().toLowerCase();
        if (lang) {
          params.set('lang', lang);
        }
        if (variant) {
          params.set('variant', variant);
        }
        presentationUrl = `${presentationUrl}?${params.toString()}`;
      }
      let windowUrl = presentationUrl;
      if (shouldWrapInPip) {
        const host = AppContext.hostLANURL || AppContext.hostURL;
        const params = new URLSearchParams();
        params.set('src', presentationUrl);
        params.set('side', AppContext.config.pipSide || 'left');
        params.set('color', AppContext.config.pipColor || '#00ff00');
        params.set('start', 'off');
        windowUrl = `http://${host}:${AppContext.config.viteServerPort}/pip.html?${params.toString()}`;
      }

      // Detect command line parameters for --ozone-platform=x11
      const argv = Array.isArray(process.argv) ? process.argv : [];
      const hasOzoneX11 = argv.some((arg, i) =>
        arg === '--ozone-platform=x11' ||
        (arg === '--ozone-platform' && argv[i + 1] === 'x11')
      );
      if (hasOzoneX11) {
        AppContext.log('🖥️  Ozone X11 platform detected, setting window options for X11');
      }
      const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' && !hasOzoneX11;

      // Check if the presentation window already exists
      if (this.presWindow && !this.presWindow.isDestroyed()) {
        if (this.windowIsExternal !== null && this.windowIsExternal !== isExternal) {
          AppContext.log('Presentation window preload mode mismatch — recreating window.');
          this.closeWindow();
          this.presWindow = null;
        } else {
          if (this.notesWindow && !this.notesWindow.isDestroyed()) {
            this.notesWindow.close();
          }
          this.presentationDisplayId = targetDisplay.id;
          if (!isWayland) {
            this.presWindow.setBounds({
              x: targetDisplay.bounds.x,
              y: targetDisplay.bounds.y,
              width: targetDisplay.bounds.width,
              height: targetDisplay.bounds.height
            });
          }
          this.presWindow.setFullScreen(!!fullscreen);
          AppContext.log(`Replacing presentation in existing window: ${windowUrl}`);
          this.presWindow.loadURL(windowUrl);
          this.presWindow.focus();
          this.windowIsExternal = isExternal;
          return;
        }
      }

      AppContext.log('Opening presentation on display:', targetDisplay.id);
      AppContext.log(`Display bounds: x=${targetDisplay.bounds.x}, y=${targetDisplay.bounds.y}, width=${targetDisplay.bounds.width}, height=${targetDisplay.bounds.height}`);
      this.presentationDisplayId = targetDisplay.id;

      const preload = isExternal && !shouldWrapInPip ? null : AppContext.presentationPreload;
      let options = {
          autoHideMenuBar: true,
          webPreferences: {
            preload
          }
        };

      if (isWayland) {
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
                preload: isExternal ? null : AppContext.presentationPreload
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
                label: 'Increase Font Size',
                accelerator: 'CmdOrCtrl+=',
                click: () => this.applyNotesZoomDelta(0.1)
              },
              {
                label: 'Decrease Font Size',
                accelerator: 'CmdOrCtrl+-',
                click: () => this.applyNotesZoomDelta(-0.1)
              },
              {
                label: 'Reset Font Size',
                accelerator: 'CmdOrCtrl+0',
                click: () => this.resetNotesZoom()
              },
              { type: 'separator' },
              {
                label: 'Close Notes Window',
                click: () => this.notesWindow?.close()
              }
            ]
          }
        ]);
        this.notesWindow.setMenu(notesMenu);
        this.notesWindow.webContents.on('before-input-event', (event, input) => {
          if (this.handleNotesZoomShortcut(input)) {
            event.preventDefault();
          }
        });
        this.moveNotesWindowToSecondaryDisplay(AppContext, this.notesWindow);
        AppContext.log(`Managed speaker notes window created (frame: ${frameName || 'n/a'}).`);
        this.notesWindow.on('closed', () => {
          this.notesWindow = null;
          AppContext.log('Speaker notes window closed.');
        });
      });
      AppContext.log(`Opening presentation window: ${windowUrl}`);
      this.presWindow.loadURL(windowUrl);
      // this.presWindow.webContents.openDevTools()  // Uncomment for debugging
      this.windowIsExternal = isExternal;

      AppContext.log('Power save blocker started');
      this.powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');

      this.presWindow.on('closed', async () => {
        AppContext.log('Presentation window closed.');

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

    normalizeAdditionalScreens(rawList) {
      if (!Array.isArray(rawList)) return [];
      return rawList
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const target = item.target === 'display' ? 'display' : 'window';
          const parsedIndex = Number.parseInt(item.displayIndex, 10);
          const displayIndex = Number.isFinite(parsedIndex) && parsedIndex >= 0 ? parsedIndex : null;
          const language = typeof item.language === 'string' ? item.language.trim().toLowerCase() : '';
          const variant = typeof item.variant === 'string' ? item.variant.trim().toLowerCase() : '';
          if (target === 'display' && displayIndex === null) return null;
          return { target, displayIndex, language, variant };
        })
        .filter(Boolean);
    },

    hasOzoneX11Override() {
      const argv = Array.isArray(process.argv) ? process.argv : [];
      return argv.some((arg, i) =>
        arg === '--ozone-platform=x11' ||
        (arg === '--ozone-platform' && argv[i + 1] === 'x11')
      );
    },

    isWaylandSession() {
      return process.env.XDG_SESSION_TYPE === 'wayland' && !this.hasOzoneX11Override();
    },

    async openAdditionalScreensForPeerUrl(AppContext, url) {
      const additionalScreens = this.normalizeAdditionalScreens(AppContext.config.additionalScreens);
      this.closeAdditionalScreens();
      if (!additionalScreens.length) {
        return;
      }

      const displays = screen.getAllDisplays();
      const isWayland = this.isWaylandSession();

      if (isWayland) {
        AppContext.log('⚠️ Wayland session detected: additional display placement may require --ozone-platform=x11');
      }

      for (const [idx, config] of additionalScreens.entries()) {
        const resolvedPresentationUrl = applyPresentationOptions(url, AppContext.config, {
          language: config.language || (AppContext.config.preferredPresentationLanguage || AppContext.config.language || 'en'),
          variant: config.variant || ''
        });

        const display = config.target === 'display' ? displays[config.displayIndex] : null;
        const useDisplay = !!display;
        if (config.target === 'display' && !display) {
          AppContext.log(`Additional screen ${idx + 1}: display ${config.displayIndex} unavailable, opening in window mode.`);
        }

        const options = {
          autoHideMenuBar: true,
          webPreferences: {
            preload: null
          }
        };

        if (useDisplay && !isWayland) {
          options.fullscreen = true;
          options.x = display.bounds.x;
          options.y = display.bounds.y;
          options.width = display.bounds.width;
          options.height = display.bounds.height;
        } else if (useDisplay && isWayland) {
          options.frame = false;
          options.kiosk = true;
        } else {
          options.width = 1280;
          options.height = 720;
        }

        const win = new BrowserWindow(options);
        win.setMenu(null);
        win.webContents.setWindowOpenHandler(({ url: href }) => {
          if (href) {
            shell.openExternal(href).catch((err) => {
              AppContext.error('Failed to open external link from additional screen:', err.message);
            });
          }
          return { action: 'deny' };
        });

        const record = { win, config };
        this.additionalScreenWindows.push(record);

        win.on('closed', () => {
          this.additionalScreenWindows = this.additionalScreenWindows.filter((item) => item.win !== win);
        });

        AppContext.log(`Opening additional screen ${idx + 1}: ${resolvedPresentationUrl}`);
        win.loadURL(resolvedPresentationUrl);
      }
    },

    closeAdditionalScreens() {
      const windows = Array.isArray(this.additionalScreenWindows)
        ? [...this.additionalScreenWindows]
        : [];
      this.additionalScreenWindows = [];
      windows.forEach(({ win }) => {
        if (win && !win.isDestroyed()) {
          win.close();
        }
      });
    },

    applyNotesZoomDelta(delta) {
      if (!this.notesWindow || this.notesWindow.isDestroyed()) return;
      const contents = this.notesWindow.webContents;
      const current = contents.getZoomFactor();
      const next = Math.max(0.25, Math.min(5, current + delta));
      contents.setZoomFactor(next);
    },

    resetNotesZoom() {
      if (!this.notesWindow || this.notesWindow.isDestroyed()) return;
      this.notesWindow.webContents.setZoomFactor(1);
    },

    handleNotesZoomShortcut(input) {
      if (!input) return false;
      const hasPrimaryModifier = !!input.control || !!input.meta;
      if (!hasPrimaryModifier || input.alt) return false;
      const key = String(input.key || '').toLowerCase();
      const code = String(input.code || '');

      if (key === '+' || (key === '=' && !!input.shift) || code === 'NumpadAdd') {
        this.applyNotesZoomDelta(0.1);
        return true;
      }
      if (key === '-' || code === 'NumpadSubtract') {
        this.applyNotesZoomDelta(-0.1);
        return true;
      }
      if (key === '0' || code === 'Digit0' || code === 'Numpad0') {
        this.resetNotesZoom();
        return true;
      }
      return false;
    },

    togglePresentationWindow() {
        if (this.presWindow) {
            this.presWindow.setFullScreen(!this.presWindow.isFullScreen());
        }
    },

    closeWindow(_options = {}) {
        if (this.presWindow && !this.presWindow.isDestroyed()) {
            this.presWindow.close();
        }
    }
}

module.exports = { presentationWindow };
