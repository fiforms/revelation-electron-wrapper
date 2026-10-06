/**
 * main.js -- Electron main-process entry point (package.json "main").
 *
 * LOAD-TIME ORDER (everything below runs when the file is required, before app 'ready'):
 *   0. requestSingleInstanceLock(): a second instance quits here, before it can touch config.json,
 *      debug.log or the userData resource mirror of the running instance.
 *   1. Silence console/stdout unless started with --enable-debug (debugEnabled).
 *   2. process 'uncaughtException' guard: transient mDNS/dgram network errors are non-fatal,
 *      anything else exits.
 *   3. ensureWritableResources() mirrors resources/revelation + resources/plugins into
 *      <userData>/resources when the install dir is read-only (or a mirror already exists) and
 *      re-syncs it when the bundled revelation version changes; ensureAppNodeModulesOnPath().
 *   4. require() every lib/ module, loadConfig() (lib/configManager.js), build AppContext,
 *      load http_admin/locales/translations.json.
 *   5. <module>.register(ipcMain, AppContext) for each lib module (this is where almost all IPC
 *      handlers and AppContext.callbacks['menu:*'] entries are created), then the 'second-instance' handler.
 *
 * app.whenReady() SEQUENCE:
 *   splash -> resolveFfmpegBinary -> first-run language/setup window (may relaunch the app) ->
 *   regenerate the "readme" docs presentation if app version changed -> serverManager.startServers
 *   (Vite in an Electron utilityProcess) -> LAN IP watcher, mDNS, peerCommandClient, apiServer ->
 *   createMainWindow({deferShow}) -> splash hand-off -> queued .revel file -> Linux .revel icon ->
 *   application menu -> update check (1.5 s later). Always-open presentation screens start 12 s later.
 * SHUTDOWN: 'before-quit' stops mDNS, peer client, API server, IP watcher and Vite;
 *   'window-all-closed' quits (except macOS). The main window refuses to close while other
 *   windows are open (unless Always Open mode, which closes them all and quits).
 *
 * WINDOWS: main.js creates none itself. The main window is lib/mainWindow.js (preload.js, loads
 *   /presentations.html or /admin/settings.html from Vite); the first-run window is lib/firstRunWizard.js
 *   (preload_first_run.js). Other window types live in lib/: presentation (preload_presentation.js), handout
 *   (preload_handout.js), profile dialog (preload_profile_dialog.js); about/export/builder/create
 *   windows reuse preload.js; the splash and offscreen export windows have no preload.
 *
 * IPC OWNED HERE: reload-servers, relaunch-app. The first-run:* channels are in lib/firstRunWizard.js
 *   (and lib/popplerInstaller.js for first-run:install-poppler).
 *
 * WHERE THINGS LIVE (main.js is only the wiring): lib/startupGuards.js (debug silencing, crash guard, HTTPS
 *   cert trust), lib/appResources.js (writable resource mirror), lib/appContext.js (AppContext + zoom),
 *   lib/mainWindow.js (main window, application menu, always-open screens), lib/firstRunWizard.js (first-run
 *   setup), lib/popplerRelease.js (Poppler plugin download URLs + SHA-256 hashes -- edit per release).
 *
 * AppContext (single shared object handed to every register()):
 *   win, hostURL ('localhost' always), hostLANURL (LAN IP or 'localhost'; used in URLs given to
 *   other devices), config (see lib/configManager.js; runtime-only keys runtimeEnableDebug /
 *   runtimeEnableDevTools / pluginFolder / configuredViteServerPort / configuredApiServerPort are
 *   stripped or handled on save), preload / presentationPreload / handoutPreload (script paths),
 *   mainMenuTemplate, callbacks (menu action registry, invoked with AppContext.callback(name)),
 *   currentMode, plugins, pluginPeerCommandHandlers, translations, mdnsPeers, pairedPeerCache,
 *   ffmpegPath (auto-detected binary, runtime only), profileList, forceCloseMain, logStream, plus methods
 *   log/warn/error/resetLog/callback/translate/saveConfig/reloadConfig/applyZoomFactorToAllWindows/
 *   reloadServers. Added later by other modules:
 *   presenterLiveRoomId (serverManager), allPluginFolders (pluginDirector).
 */

const { app, BrowserWindow, ipcMain } = require('electron');

// Take the single-instance lock before anything else: loadConfig() can write config.json and
// generate keys, ensureWritableResources() copies files, and AppContext.resetLog() truncates
// debug.log. A second launch must do none of that to the running instance's state.
// (The 'second-instance' handler is registered further down, once AppContext exists.)
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// Node built-ins and the startup helpers needed before AppContext exists
const path = require('path');
const fs = require('fs');
const { resolveFfmpegBinary } = require('./lib/ffmpegResolver');
const { splashWindow } = require('./lib/splashWindow');
const { shouldRestoreMainWindow } = require('./lib/backgroundWindows');
const {
  isDebugEnabled,
  silenceOutputUnlessDebug,
  installNetworkErrorGuard,
  trustPrivateNetworkCertificates
} = require('./lib/startupGuards');
const { ensureWritableResources, ensureAppNodeModulesOnPath } = require('./lib/appResources');

// Debug mode: quiet the console unless --enable-debug, and survive harmless mDNS network errors.
// Must be resolved and applied before anything else logs.
const debugEnabled = isDebugEnabled();
silenceOutputUnlessDebug(debugEnabled);
installNetworkErrorGuard();

// Packaged builds: use a writable copy of the bundled resources, and let plugins require() the app's packages
ensureWritableResources();
ensureAppNodeModulesOnPath();

// The app's modules; each exposes register(ipcMain, AppContext) or a small API.
// Required only after the resource setup above.
const { createPresentation } = require('./lib/createPresentation');
const { importPresentation } = require('./lib/importPresentation');
const { openedPresentation } = require('./lib/openedPresentation');
const { scheduleLinuxFileIcon } = require('./lib/linuxFileIcon');
const { exportPresentation } = require('./lib/exportPresentation');
const { otherEventHandlers } = require('./lib/otherEventHandlers');
const { presentationWindow } = require('./lib/presentationWindow');
const { aboutWindow } = require('./lib/aboutWindow');
const { mainMenu } = require('./lib/mainMenu');
const { serverManager } = require('./lib/serverManager');
const { configPath } = require('./lib/configManager');
const { profileWindow } = require('./lib/profileWindow');
const { settingsWindow } = require('./lib/settingsWindow');
const { mdnsManager } = require('./lib/mdnsManager');
const { peerPairingWindow } = require('./lib/peerPairingWindow');
const { pdfExport } = require('./lib/pdfExport');
const { handoutWindow } = require('./lib/handoutWindow');
const { mediaLibrary } = require('./lib/mediaLibrary');
const { pluginDirector } = require('./lib/pluginDirector');
const { exportWindow } = require('./lib/exportWindow');
const { peerCommandClient } = require('./lib/peerCommandClient');
const { presentationBuilderWindow } = require('./lib/presentationBuilderWindow');
const { checkForUpdates } = require('./lib/updateChecker');
const { apiServer } = require('./lib/apiServer');
const { ensureDocumentationPresentation } = require('./lib/docsPresentationBuilder');
const { createAppContext, applyZoomFactorToWindow } = require('./lib/appContext');
const mainWindow = require('./lib/mainWindow');
const firstRunWizard = require('./lib/firstRunWizard');

// Command-line switches
const RUNTIME_DEVTOOLS_FLAG = '--enable-devtools';

const cliArgs = Array.isArray(process.argv) ? process.argv : [];
const runtimeDevToolsEnabled = cliArgs.includes(RUNTIME_DEVTOOLS_FLAG)
  || app.commandLine.hasSwitch('enable-devtools');

// Create the shared AppContext (passed to every module's register(ipcMain, AppContext);
// see header), then fill in config, paths and translations
const AppContext = createAppContext({ debugEnabled, runtimeDevToolsEnabled });

// Shorthand so callers don't pass AppContext each time
const createMainWindow = (options) => mainWindow.createMainWindow(AppContext, options);

// Captured before loadConfig() creates the file; together with firstRunCompleted this decides
// whether the first-run window shows.
const hadConfigAtStartup = fs.existsSync(configPath);
AppContext.reloadConfig();
if (runtimeDevToolsEnabled) {
  AppContext.log(`Runtime DevTools enabled via ${RUNTIME_DEVTOOLS_FLAG}`);
}

// Server mode (localhost or network) and a fresh debug log
AppContext.currentMode = AppContext.config.mode || 'localhost';
AppContext.resetLog();

// Preload scripts for the main, presentation and handout windows
AppContext.preload = path.join(__dirname, 'preload.js');
AppContext.presentationPreload = path.join(__dirname, 'preload_presentation.js');
AppContext.handoutPreload = path.join(__dirname, 'preload_handout.js');

// Server addresses: app screens always use localhost; LAN URL is for other devices
AppContext.hostURL = 'localhost';
AppContext.hostLANURL = serverManager.getHostURL(AppContext.config.mode);

// Load UI translations (used by menus, first-run and error pages)
const translationsPath = app.isPackaged
  ? path.join(process.resourcesPath, 'http_admin', 'locales', 'translations.json')
  : path.join(__dirname, 'http_admin', 'locales', 'translations.json');
AppContext.translations = JSON.parse(fs.readFileSync(translationsPath, 'utf8'));
console.log(`Loaded ${Object.keys(AppContext.translations).length} translations.`);

// Tell Chromium the UI language (spell-check, dialogs)
app.commandLine.appendSwitch('lang', AppContext.config.language || 'en');

// Accept our self-signed certificate for localhost / LAN addresses
if (AppContext.config.httpsEnabled) {
  trustPrivateNetworkCertificates();
}

// Register every module's IPC handlers and menu callbacks
createPresentation.register(ipcMain, AppContext);
exportPresentation.register(ipcMain, AppContext);
otherEventHandlers.register(ipcMain, AppContext);
presentationWindow.register(ipcMain, AppContext);
importPresentation.register(ipcMain, AppContext);
openedPresentation.register(ipcMain, AppContext);
pdfExport.register(ipcMain, AppContext);
handoutWindow.register(ipcMain, AppContext);
settingsWindow.register(ipcMain, AppContext);
peerPairingWindow.register(ipcMain, AppContext);
aboutWindow.register(ipcMain, AppContext);
mainMenu.register(ipcMain, AppContext);
mediaLibrary.register(ipcMain, AppContext);
pluginDirector.register(ipcMain, AppContext);
exportWindow.register(ipcMain, AppContext);
presentationBuilderWindow.register(ipcMain, AppContext);
profileWindow.register(ipcMain, AppContext);
firstRunWizard.register(ipcMain, AppContext);

let appQuitting = false; // set by 'before-quit'; a second launch after this cannot rescue the app

// Single-instance hand-off. The lock itself is taken at the top of this file.
app.on('second-instance', (_event, commandLine, workingDirectory) => {
  // The main window was closed while a hidden capture kept the app alive: the new launch wins and
  // reopens it, which cancels the pending quit. Too late once before-quit has run.
  let restored = false;
  if (shouldRestoreMainWindow({ mainWin: AppContext.win, quitting: appQuitting }) && openedPresentation.isReady()) {
    AppContext.forceCloseMain = false;
    createMainWindow();
    restored = true;
  }

  // A .revel file double-clicked while the app is already running arrives as argv here, and
  // opening it also brings the running instance forward.
  const revelFile = openedPresentation.findRevelFileInArgv(commandLine, workingDirectory);
  if (revelFile) {
    openedPresentation.handleOpenRequest(AppContext, revelFile);
    return;
  }
  if (restored) return;

  // Someone tried to run a second instance — focus main window
  // Still hidden behind the splash during startup — the hand-off will show it.
  if (AppContext.win && !AppContext.win.isDestroyed() && openedPresentation.isReady()) {
    if (AppContext.win.isMinimized()) AppContext.win.restore();
    AppContext.win.show();
    AppContext.win.focus();
    console.log('🔁 Second instance triggered — focusing main window');
  }
});

// First launch via a .revel file on Windows/Linux, or macOS open-file (can fire before ready,
// and also while running). Files are queued and handled once the main window exists.
const startupRevelFile = openedPresentation.findRevelFileInArgv(process.argv);
if (startupRevelFile) openedPresentation.queue(startupRevelFile);
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  openedPresentation.handleOpenRequest(AppContext, filePath);
});

// Startup sequence: runs once Electron is ready
app.whenReady().then(async () => {
  // Every new window gets the saved zoom level, and F12 opens DevTools when --enable-devtools is set
  app.on('browser-window-created', (_event, window) => {
    if (!window || window.isDestroyed()) return;
    applyZoomFactorToWindow(window, AppContext.config.zoomFactor, AppContext);
    window.webContents.on('before-input-event', (event, input) => {
      if (!AppContext.config.runtimeEnableDevTools) return;
      if (input.type !== 'keyDown' || input.key !== 'F12') return;
      event.preventDefault();
      window.webContents.openDevTools({ mode: 'detach' });
    });
  });

  // Show the splash before any slow startup work (ffmpeg probe, docs
  // generation, Vite) so the user sees the app is starting.
  splashWindow.show();

  // Resolve ffmpeg binary early for all code paths (including plugins). Kept on AppContext, not in
  // config: config.ffmpegPath is the user's own setting and is what gets saved.
  const ffmpegBinary = await resolveFfmpegBinary(AppContext);
  if (ffmpegBinary) {
    AppContext.ffmpegPath = ffmpegBinary;
    AppContext.log(`✅ FFmpeg resolved to: ${ffmpegBinary}`);
  } else {
    AppContext.log(
      '⚠️ FFmpeg binary not found. Video/audio features may not work. ' +
      'Configure ffmpegPath in settings or ensure ffmpeg is installed.'
    );
  }

  // First launch: language/setup window. Quit here if the user closed it or the app is relaunching
  const shouldContinueStartup = await firstRunWizard.maybeShowPrompt(AppContext, { hadConfigAtStartup });
  if (!shouldContinueStartup) {
    splashWindow.close();
    app.quit();
    return;
  }
  splashWindow.unhide();

  // Rebuild the in-app documentation presentation if the app version changed
  ensureDocumentationPresentation(AppContext, { appVersion: app.getVersion(), wrapperRoot: __dirname, pluginsDir: pluginDirector.resolvePluginFolder(AppContext) });

  // Start the Vite server and the networking services (LAN IP watcher, mDNS, peer sync, control API)
  await serverManager.startServers(AppContext.config.mode, AppContext);
  serverManager.startIPWatcher(AppContext);
  mdnsManager.refresh(AppContext);
  peerCommandClient.start(AppContext);
  await apiServer.start(AppContext);
  // Clear leftovers from a previously opened .revel file
  openedPresentation.cleanupOnStartup(AppContext);

  // Create the main window hidden; the splash reveals it once it has loaded
  const mainWindowReady = createMainWindow({
    deferShow: true,
    initialPage: firstRunWizard.consumeOpenPluginSettingsRequest() ? 'plugin-settings' : null
  });
  splashWindow.handOffTo(AppContext.win, mainWindowReady);
  // Open any .revel file that was double-clicked to launch the app
  openedPresentation.flushPending(AppContext);
  // Linux: electron-builder cannot set a .revel file icon, so install it per user.
  scheduleLinuxFileIcon(AppContext, { app, wrapperRoot: __dirname, pluginsDir: pluginDirector.resolvePluginFolder(AppContext) });

  // Once the window has been shown, later open requests open immediately and bring it forward.
  if (AppContext.win.isVisible()) {
    openedPresentation.markReady(AppContext);
  } else {
    AppContext.win.once('show', () => openedPresentation.markReady(AppContext));
  }

  // Final setup: zoom, published-URL file, persistent presentation screens and the application menu
  AppContext.applyZoomFactorToAllWindows(AppContext.config.zoomFactor);
  presentationWindow.syncUrlPublishForConfig?.(AppContext);
  mainWindow.scheduleAlwaysOpenScreens(AppContext);
  mainWindow.applyApplicationMenu(AppContext);

  // Check for a newer release shortly after startup, without blocking it
  setTimeout(() => {
    checkForUpdates(AppContext).catch((err) => {
      AppContext.error('Update check error:', err.message);
    });
  }, 1500);
});

// Shut down timers, networking and the Vite server before the app exits
app.on('before-quit', () => {
  appQuitting = true;
  mainWindow.cancelAlwaysOpenScreens();
  presentationWindow.markAppQuitting?.();
  mdnsManager.stop(AppContext);
  peerCommandClient.stop();
  apiServer.stop();
  serverManager.stopIPWatcher();
  serverManager.stopServers(AppContext);
});

// Close the app when the last window is closed, except on macOS where apps stay running without a window
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// macOS: clicking the dock icon with no windows open brings the main window back
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// Used by IPC "reload-servers" and the settingsWindow reset/delete actions: force-restarts Vite
// (serverManager.switchMode), rebuilds the menu and plugin list, closes and recreates the main window.
// It does NOT re-read config.json; call AppContext.reloadConfig() first if the file changed.
AppContext.reloadServers = async () => {
  AppContext.log('Reloading servers...');
  AppContext.forceCloseMain = true;

  await serverManager.switchMode(AppContext.config.mode, AppContext,  () => {
      mainWindow.cancelAlwaysOpenScreens();
      AppContext.mainMenuTemplate = [];
      mainMenu.register(ipcMain,AppContext);
      pluginDirector.populatePlugins(AppContext);
      pluginDirector.writePluginsIndex(AppContext);
      mdnsManager.refresh(AppContext);
      if(AppContext.win) {
        AppContext.win.close();
        createMainWindow();  // Relaunch main window
        AppContext.applyZoomFactorToAllWindows(AppContext.config.zoomFactor);
        presentationWindow.syncUrlPublishForConfig?.(AppContext);
        mainWindow.scheduleAlwaysOpenScreens(AppContext);
        mainWindow.applyApplicationMenu(AppContext);
      }
    }, true); // Force reload

  AppContext.forceCloseMain = false;
  AppContext.log('Servers reloaded successfully');
}

// Renderer requests: restart the servers, or relaunch the whole app
ipcMain.handle('reload-servers', AppContext.reloadServers);

ipcMain.handle('relaunch-app', () => {
  app.relaunch();
  app.exit(0);
  return { success: true, relaunching: true };
});
