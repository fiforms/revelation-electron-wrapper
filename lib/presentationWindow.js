// Presentation Window Module

const { app, BrowserWindow, Menu, shell, screen, powerSaveBlocker, globalShortcut } = require('electron');

function applyPresentationOptions(url, config, overrides = {}) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return url;
    }
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

function buildInternalPresentationUrl(AppContext, slug, mdFile, overrides = {}) {
  const p_key = AppContext.config.key;
  const host = AppContext.hostLANURL || AppContext.hostURL;
  let presentationUrl = `http://${host}:${AppContext.config.viteServerPort}/presentations_${p_key}/${slug}/index.html`;
  const params = new URLSearchParams();
  params.set('p', mdFile);
  if (AppContext.config.preferHighBitrate) {
    params.set('media', 'high');
  }
  const requestedLanguage = Object.prototype.hasOwnProperty.call(overrides, 'language')
    ? overrides.language
    : (AppContext.config.preferredPresentationLanguage || AppContext.config.language || 'en');
  const requestedVariant = Object.prototype.hasOwnProperty.call(overrides, 'variant')
    ? overrides.variant
    : (AppContext.config.screenTypeVariant || '');
  const lang = String(requestedLanguage || '').trim().toLowerCase();
  const variant = String(requestedVariant || '').trim().toLowerCase();
  const ccli = String(AppContext.config.ccliLicenseNumber || '').trim();
  if (lang) {
    params.set('lang', lang);
  }
  if (variant) {
    params.set('variant', variant);
  }
  if (ccli) {
    params.set('ccli', ccli);
  }
  presentationUrl = `${presentationUrl}?${params.toString()}`;
  return presentationUrl;
}

const presentationWindow = {
    presWindow: null,
    notesWindow: null,
    additionalScreenWindows: [],
    powerSaveBlockerId: null,
    isRemote: false,
    presentationDisplayId: null,
    windowIsExternal: null,
    registeredGlobalShortcuts: [],
    suppressAdditionalScreenReopen: false,
    appShuttingDown: false,
    pendingAdditionalScreenClosures: 0,
    appContext: null,
    alwaysOpenModeActive: false,

    register(ipcMain, AppContext) {
        this.appContext = AppContext;

        // Handle opening the main presentation window
        ipcMain.handle('open-presentation', async (_event, slug, mdFile, fullscreen, overrides = {}) => {
             return await this.openWindow(AppContext, slug, mdFile, fullscreen, overrides);
        });

        ipcMain.handle('close-presentation', () => {
            this.closeWindow();
        });

        ipcMain.handle('toggle-presentation', (_event) => {
            this.togglePresentationWindow();
        });
    },
    async openWindow(AppContext, slug, mdFile, fullscreen, overrides = {}) {

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

      let presentationUrl;
      if (isExternal) {
        presentationUrl = applyPresentationOptions(slug, AppContext.config, overrides);
      } else {
        presentationUrl = buildInternalPresentationUrl(AppContext, slug, mdFile, overrides);
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
        const keepMainWindowAlive = this.shouldUseAlwaysOpenBehavior(AppContext?.config || {});
        if (!keepMainWindowAlive && this.windowIsExternal !== null && this.windowIsExternal !== isExternal) {
          AppContext.log('Presentation window preload mode mismatch — recreating window.');
          await this.forceCloseMainPresentationWindow(AppContext);
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
          this.registerGlobalHotkeys(AppContext);
          this.presWindow.focus();
          this.windowIsExternal = isExternal;
          return;
        }
      }

      AppContext.log('Opening presentation on display:', targetDisplay.id);
      AppContext.log(`Display bounds: x=${targetDisplay.bounds.x}, y=${targetDisplay.bounds.y}, width=${targetDisplay.bounds.width}, height=${targetDisplay.bounds.height}`);
      this.presentationDisplayId = targetDisplay.id;

      const forcePresentationPreload = overrides?.forcePresentationPreload === true;
      const preload = (isExternal && !shouldWrapInPip && !forcePresentationPreload)
        ? null
        : AppContext.presentationPreload;
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
      this.registerGlobalHotkeys(AppContext);
      // this.presWindow.webContents.openDevTools()  // Uncomment for debugging
      this.windowIsExternal = isExternal;

      AppContext.log('Power save blocker started');
      this.powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');

      this.presWindow.on('closed', async () => {
        AppContext.log('Presentation window closed.');
        this.unregisterGlobalHotkeys();
        this.presWindow = null;

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
          const rawDefaultMode = typeof item.defaultMode === 'string' ? item.defaultMode.trim().toLowerCase() : '';
          const defaultMode = ['black', 'green', 'presentation'].includes(rawDefaultMode) ? rawDefaultMode : '';
          const defaultPresentation = typeof item.defaultPresentation === 'string' ? item.defaultPresentation.trim() : '';
          if (target === 'display' && displayIndex === null) return null;
          return { target, displayIndex, language, variant, defaultMode, defaultPresentation };
        })
        .filter(Boolean);
    },

    getAdditionalScreenSignature(config = {}) {
      return `${config.target || 'window'}:${config.displayIndex ?? 'none'}:${config.language || ''}:${config.variant || ''}:${config.defaultMode || ''}:${config.defaultPresentation || ''}`;
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

    getPresentationScreenMode(config = {}) {
      const mode = String(config.presentationScreenMode || '').trim().toLowerCase();
      if (mode === 'always-open' || mode === 'group-control' || mode === 'on-demand') {
        return mode;
      }
      if (typeof config.virtualPeersAlwaysOpen === 'boolean') {
        return config.virtualPeersAlwaysOpen ? 'group-control' : 'on-demand';
      }
      return 'group-control';
    },

    isAlwaysOpenModeActive() {
      return this.alwaysOpenModeActive === true;
    },

    shouldUseAlwaysOpenBehavior(config = {}) {
      const mode = this.getPresentationScreenMode(config);
      if (mode === 'always-open') return true;
      if (mode === 'group-control') return this.isAlwaysOpenModeActive();
      return false;
    },

    canActivatePersistentScreens(config = {}) {
      const mode = this.getPresentationScreenMode(config);
      return mode === 'always-open' || mode === 'group-control';
    },

    shouldAutoActivatePersistentScreens(config = {}) {
      return this.getPresentationScreenMode(config) === 'always-open';
    },

    getVirtualPeersDefaultMode(config = {}) {
      const mode = String(config.virtualPeersDefaultMode || 'black').trim().toLowerCase();
      if (mode === 'green' || mode === 'presentation') {
        return mode;
      }
      return 'black';
    },

    getScreenDefaultMode(screenConfig = {}) {
      const mode = String(screenConfig.defaultMode || '').trim().toLowerCase();
      if (mode === 'black' || mode === 'green' || mode === 'presentation') {
        return mode;
      }
      return '';
    },

    parseDefaultPresentationPath(rawPath = '') {
      const normalized = String(rawPath || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (!normalized) return null;
      const slashIndex = normalized.indexOf('/');
      if (slashIndex <= 0 || slashIndex === normalized.length - 1) return null;
      const slug = normalized.slice(0, slashIndex).trim();
      const mdFile = normalized.slice(slashIndex + 1).trim();
      if (!slug || !mdFile) return null;
      if (slug.includes('/') || mdFile.includes('..')) return null;
      return { slug, mdFile };
    },

    buildSolidColorScreenUrl(mode = 'black') {
      const color = mode === 'green' ? '#00ff00' : '#000000';
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:${color};overflow:hidden;}</style></head><body></body></html>`;
      return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    },

    closeAdditionalScreenWindowSilently(win) {
      if (!win || win.isDestroyed()) return;
      this.pendingAdditionalScreenClosures += 1;
      win.close();
    },

    resolveDefaultAdditionalScreenUrl(AppContext, screenConfig = {}) {
      const mode = this.getScreenDefaultMode(screenConfig) || this.getVirtualPeersDefaultMode(AppContext?.config || {});
      if (mode === 'presentation') {
        const localPath = String(screenConfig.defaultPresentation || '').trim();
        const parsed = this.parseDefaultPresentationPath(localPath || AppContext?.config?.virtualPeersDefaultPresentation || '');
        if (parsed) {
          return buildInternalPresentationUrl(AppContext, parsed.slug, parsed.mdFile, {
            language: screenConfig.language || (AppContext.config.preferredPresentationLanguage || AppContext.config.language || 'en'),
            variant: screenConfig.variant || ''
          });
        }
        AppContext.log('Virtual peer default presentation path invalid; using solid black default screen.');
      }
      return this.buildSolidColorScreenUrl(mode);
    },

    resolveDefaultMainPresentationUrl(AppContext) {
      const mode = this.getVirtualPeersDefaultMode(AppContext?.config || {});
      if (mode === 'presentation') {
        const parsed = this.parseDefaultPresentationPath(AppContext?.config?.virtualPeersDefaultPresentation || '');
        if (parsed) {
          return buildInternalPresentationUrl(AppContext, parsed.slug, parsed.mdFile, {});
        }
        AppContext.log('Main default presentation path invalid; using solid black default screen.');
      }
      return this.buildSolidColorScreenUrl(mode);
    },

    async showDefaultOnMainPresentation(AppContext) {
      if (!AppContext) return;
      const defaultUrl = this.resolveDefaultMainPresentationUrl(AppContext);
      if (!this.presWindow || this.presWindow.isDestroyed()) {
        await this.openWindow(AppContext, defaultUrl, null, true, { forcePresentationPreload: true });
        return;
      }
      AppContext.log(`Loading default content on main presentation window: ${defaultUrl}`);
      this.presWindow.loadURL(defaultUrl);
      if (!this.presWindow.isFullScreen()) {
        this.presWindow.setFullScreen(true);
      }
      this.presWindow.focus();
    },

    createAdditionalScreenWindow(AppContext, screenConfig, idx) {
      const displays = screen.getAllDisplays();
      const isWayland = this.isWaylandSession();
      const display = screenConfig.target === 'display' ? displays[screenConfig.displayIndex] : null;
      const useDisplay = !!display;
      if (screenConfig.target === 'display' && !display) {
        AppContext.log(`Additional screen ${idx + 1}: display ${screenConfig.displayIndex} unavailable, opening in window mode.`);
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

      win.on('closed', () => {
        this.additionalScreenWindows = this.additionalScreenWindows.filter((item) => item.win !== win);
        if (this.pendingAdditionalScreenClosures > 0) {
          this.pendingAdditionalScreenClosures -= 1;
          return;
        }
        if (this.appShuttingDown || this.suppressAdditionalScreenReopen) return;
        if (!this.shouldUseAlwaysOpenBehavior(AppContext?.config || {})) return;
        setTimeout(() => {
          this.showDefaultOnAdditionalScreens(AppContext).catch((err) => {
            AppContext.error(`Failed to restore always-open virtual peers: ${err.message}`);
          });
        }, 100);
      });

      return win;
    },

    ensureAdditionalScreenWindows(AppContext, additionalScreens) {
      if (!Array.isArray(this.additionalScreenWindows)) {
        this.additionalScreenWindows = [];
      }

      const isWayland = this.isWaylandSession();
      if (isWayland) {
        AppContext.log('⚠️ Wayland session detected: additional display placement may require --ozone-platform=x11');
      }

      for (let idx = 0; idx < additionalScreens.length; idx += 1) {
        const config = additionalScreens[idx];
        const signature = this.getAdditionalScreenSignature(config);
        const existing = this.additionalScreenWindows[idx];
        let shouldCreate = true;
        if (existing?.win && !existing.win.isDestroyed() && existing.signature === signature) {
          shouldCreate = false;
        } else if (existing?.win && !existing.win.isDestroyed()) {
          this.closeAdditionalScreenWindowSilently(existing.win);
        }

        if (shouldCreate) {
          const win = this.createAdditionalScreenWindow(AppContext, config, idx);
          this.additionalScreenWindows[idx] = { win, config, signature };
        } else {
          this.additionalScreenWindows[idx] = { ...existing, config, signature };
        }
      }

      for (let idx = this.additionalScreenWindows.length - 1; idx >= additionalScreens.length; idx -= 1) {
        const record = this.additionalScreenWindows[idx];
        if (record?.win && !record.win.isDestroyed()) {
          this.closeAdditionalScreenWindowSilently(record.win);
        }
        this.additionalScreenWindows.splice(idx, 1);
      }
    },

    async showDefaultOnAdditionalScreens(AppContext) {
      const additionalScreens = this.normalizeAdditionalScreens(AppContext.config.additionalScreens);
      if (!additionalScreens.length) {
        this.closeAdditionalScreens({ allowReopen: false });
        return;
      }
      this.ensureAdditionalScreenWindows(AppContext, additionalScreens);
      for (const [idx, screenConfig] of additionalScreens.entries()) {
        const record = this.additionalScreenWindows[idx];
        if (!record?.win || record.win.isDestroyed()) continue;
        const url = this.resolveDefaultAdditionalScreenUrl(AppContext, screenConfig);
        AppContext.log(`Loading default content on additional screen ${idx + 1}: ${url}`);
        record.win.loadURL(url);
      }
    },

    async openAdditionalScreensForPeerUrl(AppContext, url) {
      const additionalScreens = this.normalizeAdditionalScreens(AppContext.config.additionalScreens);
      if (!additionalScreens.length) {
        return;
      }
      this.ensureAdditionalScreenWindows(AppContext, additionalScreens);

      for (const [idx, config] of additionalScreens.entries()) {
        const resolvedPresentationUrl = applyPresentationOptions(url, AppContext.config, {
          language: config.language || (AppContext.config.preferredPresentationLanguage || AppContext.config.language || 'en'),
          variant: config.variant || ''
        });
        const record = this.additionalScreenWindows[idx];
        if (!record?.win || record.win.isDestroyed()) continue;
        AppContext.log(`Opening additional screen ${idx + 1}: ${resolvedPresentationUrl}`);
        record.win.loadURL(resolvedPresentationUrl);
      }
    },

    async refreshAdditionalScreensForConfig(AppContext) {
      if (this.shouldUseAlwaysOpenBehavior(AppContext?.config || {})) {
        await this.showDefaultOnAdditionalScreens(AppContext);
        return;
      }
      this.closeAdditionalScreens({ allowReopen: false });
    },

    async forceCloseMainPresentationWindow(AppContext) {
      if (!this.presWindow || this.presWindow.isDestroyed()) {
        this.presWindow = null;
        return;
      }
      const win = this.presWindow;
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        win.once('closed', finish);
        setTimeout(finish, 1200);
        this.closeWindow({ forceClose: true, appContext: AppContext });
      });
      this.presWindow = null;
    },

    async refreshAlwaysOpenPresentationWindowsForConfig(AppContext) {
      if (this.shouldUseAlwaysOpenBehavior(AppContext?.config || {})) {
        await this.showDefaultOnMainPresentation(AppContext);
        await this.showDefaultOnAdditionalScreens(AppContext);
        return;
      }
      this.closeAdditionalScreens({ allowReopen: false });
    },

    async activateAlwaysOpenScreens(AppContext) {
      if (!this.canActivatePersistentScreens(AppContext?.config || {})) {
        return { success: false, error: 'Presentation screen mode is On Demand.' };
      }
      this.alwaysOpenModeActive = true;
      await this.showDefaultOnMainPresentation(AppContext);
      await this.showDefaultOnAdditionalScreens(AppContext);
      return { success: true };
    },

    deactivateAlwaysOpenScreens() {
      this.alwaysOpenModeActive = false;
      this.closeAdditionalScreens({ allowReopen: false });
    },

    markAppQuitting() {
      this.appShuttingDown = true;
      this.alwaysOpenModeActive = false;
      this.closeWindow({ forceClose: true });
      this.closeAdditionalScreens({ allowReopen: false });
    },

    closeAdditionalScreens(options = {}) {
      const allowReopen = options.allowReopen === true;
      this.suppressAdditionalScreenReopen = !allowReopen;
      const windows = Array.isArray(this.additionalScreenWindows)
        ? [...this.additionalScreenWindows]
        : [];
      this.additionalScreenWindows = [];
      windows.forEach(({ win }) => {
        if (win && !win.isDestroyed()) {
          this.closeAdditionalScreenWindowSilently(win);
        }
      });
      this.suppressAdditionalScreenReopen = false;
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

    getConfiguredGlobalHotkeys(config = {}) {
      const defaults = {
        pipToggle: '',
        previous: '',
        next: '',
        blank: '',
        up: '',
        down: '',
        left: '',
        right: ''
      };
      const source = config.globalHotkeys && typeof config.globalHotkeys === 'object'
        ? config.globalHotkeys
        : {};
      return { ...defaults, ...source };
    },

    getHotkeyActionMap() {
      return {
        pipToggle: { key: 'x', code: 'KeyX', keyCode: 88 },
        previous: { key: 'p', code: 'KeyP', keyCode: 80 },
        next: { key: ' ', code: 'Space', keyCode: 32 },
        blank: { key: 'b', code: 'KeyB', keyCode: 66 },
        up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
        down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
        left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
        right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }
      };
    },

    registerGlobalHotkeys(AppContext) {
      this.unregisterGlobalHotkeys();
      if (!this.presWindow || this.presWindow.isDestroyed()) return;
      const configured = this.getConfiguredGlobalHotkeys(AppContext?.config || {});
      const actionMap = this.getHotkeyActionMap();
      const usedAccelerators = new Set();

      Object.entries(actionMap).forEach(([action, payload]) => {
        const accelerator = String(configured[action] || '').trim();
        if (!accelerator) return;
        if (usedAccelerators.has(accelerator)) {
          AppContext.log(`Skipping duplicate global hotkey "${accelerator}" for action "${action}"`);
          return;
        }
        let ok = false;
        try {
          ok = globalShortcut.register(accelerator, () => {
            this.sendKeyToPresentation(payload, AppContext);
          });
        } catch (err) {
          AppContext.error(`Failed to register global hotkey "${accelerator}" for "${action}": ${err.message}`);
          return;
        }
        if (!ok) {
          AppContext.log(`Global hotkey unavailable "${accelerator}" for action "${action}"`);
          return;
        }
        this.registeredGlobalShortcuts.push(accelerator);
        usedAccelerators.add(accelerator);
      });
    },

    unregisterGlobalHotkeys() {
      if (!Array.isArray(this.registeredGlobalShortcuts)) {
        this.registeredGlobalShortcuts = [];
        return;
      }
      this.registeredGlobalShortcuts.forEach((accelerator) => {
        try {
          globalShortcut.unregister(accelerator);
        } catch {
          // noop
        }
      });
      this.registeredGlobalShortcuts = [];
    },

    refreshGlobalHotkeys(AppContext) {
      if (!this.presWindow || this.presWindow.isDestroyed()) {
        this.unregisterGlobalHotkeys();
        return;
      }
      this.registerGlobalHotkeys(AppContext);
    },

    sendKeyToPresentation(payload, AppContext) {
      if (!this.presWindow || this.presWindow.isDestroyed()) return;
      const details = {
        key: String(payload?.key || ''),
        code: String(payload?.code || ''),
        keyCode: Number.parseInt(payload?.keyCode, 10) || 0
      };
      const script = `
        (() => {
          const details = ${JSON.stringify(details)};
          const eventInit = {
            key: details.key,
            code: details.code,
            keyCode: details.keyCode,
            which: details.keyCode,
            bubbles: true,
            cancelable: true
          };
          const targets = [window, document, document.activeElement].filter(Boolean);
          for (const target of targets) {
            try {
              target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
              target.dispatchEvent(new KeyboardEvent('keyup', eventInit));
            } catch (err) {}
          }
        })();
      `;
      this.presWindow.webContents.executeJavaScript(script).catch((err) => {
        if (AppContext?.error) {
          AppContext.error(`Failed to emit presentation key "${details.key}": ${err.message}`);
        }
      });
    },

    togglePresentationWindow() {
        if (this.presWindow) {
            this.presWindow.setFullScreen(!this.presWindow.isFullScreen());
        }
    },

    closeWindow(options = {}) {
        const AppContext = options.appContext || this.appContext;
        const forceClose = options.forceClose === true;
        const alwaysOpen = this.shouldUseAlwaysOpenBehavior(AppContext?.config || {});
        if (!forceClose && !this.appShuttingDown && alwaysOpen && AppContext) {
            this.showDefaultOnMainPresentation(AppContext).catch((err) => {
              AppContext.error(`Failed to show default main presentation: ${err.message}`);
            });
            return;
        }
        this.unregisterGlobalHotkeys();
        if (this.presWindow && !this.presWindow.isDestroyed()) {
            this.presWindow.close();
        }
    }
}

module.exports = { presentationWindow };
