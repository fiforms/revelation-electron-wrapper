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
 * WINDOWS CREATED HERE: main window (preload.js, loads /presentations.html or /admin/settings.html
 *   from Vite) and the first-run window (preload_first_run.js, loadFile http_admin/first-run-language.html).
 *   Other window types live in lib/: presentation (preload_presentation.js), handout
 *   (preload_handout.js), profile dialog (preload_profile_dialog.js); about/export/builder/create
 *   windows reuse preload.js; the splash and offscreen export windows have no preload.
 *
 * IPC OWNED HERE: reload-servers, relaunch-app, first-run:get-state, first-run:install-poppler,
 *   first-run:open-link, first-run:complete, first-run:cancel (+ internal ipcMain.emit of
 *   'first-run:startup-complete'; first-run:install-progress is sent to the renderer).
 *
 * AppContext (single shared object handed to every register()):
 *   win, hostURL ('localhost' always), hostLANURL (LAN IP or 'localhost'; used in URLs given to
 *   other devices), config (see lib/configManager.js; runtime-only keys runtimeEnableDebug /
 *   runtimeEnableDevTools / pluginFolder / configuredViteServerPort / configuredApiServerPort are
 *   stripped or handled on save), preload / presentationPreload / handoutPreload (script paths),
 *   mainMenuTemplate, callbacks (menu action registry, invoked with AppContext.callback(name)),
 *   currentMode, plugins, pluginPeerCommandHandlers, translations, mdnsPeers, pairedPeerCache,
 *   ffmpegPath (auto-detected binary, runtime only), profileList, forceCloseMain, logStream, plus methods log/warn/error/resetLog/callback/translate/
 *   warn/saveConfig/applyZoomFactorToAllWindows/reloadServers. Added later by other modules:
 *   presenterLiveRoomId (serverManager), allPluginFolders (pluginDirector).
 */

const { app, BrowserWindow, psMenu, shell, dialog, ipcMain, Menu } = require('electron');

// Take the single-instance lock before anything else: loadConfig() can write config.json and
// generate keys, ensureWritableResources() copies files, and AppContext.resetLog() truncates
// debug.log. A second launch must do none of that to the running instance's state.
// (The 'second-instance' handler is registered further down, once AppContext exists.)
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const path = require('path');
const fs = require('fs');
const fsExtra = require('fs-extra');
const os = require('os');
const Module = require('module');
const { resolveFfmpegBinary } = require('./lib/ffmpegResolver');
const { splashWindow } = require('./lib/splashWindow');
const { loadWithWatchdog } = require('./lib/loadWatchdog');

// Debug mode (--enable-debug): console output, debug.log file and the
// Help -> Debug menu. Without it the app runs silently. Must be resolved
// before anything else logs.
const DEBUG_FLAG = '--enable-debug';
const debugEnabled = (Array.isArray(process.argv) && process.argv.includes(DEBUG_FLAG))
  || app.commandLine.hasSwitch('enable-debug');
if (!debugEnabled) {
  const noop = () => {};
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    console[method] = noop;
  }
  process.stdout.write = () => true;
  process.stderr.write = () => true;
}

// Catch transient mDNS/UDP network errors that bonjour-service doesn't handle
// internally. These arise when a multicast send to 224.0.0.251:5353 fails
// (e.g. EHOSTUNREACH) because the active interface doesn't support multicast.
// Without this handler Electron shows a fatal crash dialog; instead we log the
// error and show a non-blocking toast so the app can keep running.
process.on('uncaughtException', (err) => {
  const TRANSIENT_CODES = new Set(['EHOSTUNREACH', 'ENETUNREACH', 'ENONET', 'ENETDOWN', 'ENETRESET']);
  const isDgramNetworkError =
    TRANSIENT_CODES.has(err.code) &&
    typeof err.stack === 'string' &&
    err.stack.includes('node:dgram');

  if (isDgramNetworkError) {
    console.error('[mDNS] Transient network error (non-fatal):', err.message);
    try {
      const wins = BrowserWindow.getAllWindows();
      if (wins.length > 0 && !wins[0].isDestroyed()) {
        wins[0].webContents.send('show-toast', `Peer network error: ${err.message}`);
      }
    } catch (_) { /* window may not be ready yet */ }
    return;
  }

  // All other uncaught exceptions are fatal — restore default crash behaviour.
  console.error('Uncaught exception:', err);
  process.exit(1);
});

ensureWritableResources();
ensureAppNodeModulesOnPath();

const { createPresentation } = require('./lib/createPresentation');
const { importPresentation } = require('./lib/importPresentation');
const { openedPresentation } = require('./lib/openedPresentation');
const { ensureLinuxFileIcon } = require('./lib/linuxFileIcon');
const { exportPresentation } = require('./lib/exportPresentation');
const { otherEventHandlers } = require('./lib/otherEventHandlers');
const { presentationWindow } = require('./lib/presentationWindow');
const { aboutWindow } = require('./lib/aboutWindow');
const { mainMenu } = require('./lib/mainMenu');
const { serverManager } = require('./lib/serverManager');
const { loadConfig, saveConfig, listProfiles, configPath } = require('./lib/configManager');
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
const {
  generateDocumentationPresentations,
  isDocumentationPresentationCurrent,
  getDocsManifestPath
} = require('./lib/docsPresentationBuilder');

// NOTE: `create` is unused (and `psMenu` imported from electron on line 1 does not exist).
const { create } = require('domain');
const RUNTIME_DEVTOOLS_FLAG = '--enable-devtools';
// One-shot flag: the first-run setup asked to open Settings → Plugins, but the
// app had to relaunch to apply a language change first.
const FIRST_RUN_PLUGIN_SETTINGS_FLAG = '--first-run-plugin-settings';
let firstRunLanguageWindow = null;
let alwaysOpenStartupTimer = null;

// Shared runtime state passed to every lib module's register(ipcMain, AppContext). See header.
const AppContext = {
  win: null,                      // Main application window    
  hostURL: null,           // Host URL (always localhost for app screens)
  hostLANURL: null,        // Host URL for LAN-accessible presentation URLs
  logStream: null,                // Write stream for logging
  preload: null,                  // Preload script path
  presentationPreload: null,      // Presentation preload script path
  handoutPreload: null,           // Handout preload script path
  mainMenuTemplate: [],           // Main application menu
  callbacks: {},                  // Store callback functions for menu actions
  currentMode: null,              // Current server mode (localhost or LAN)
  plugins: {},                    // Collection of plugin objects
  pluginPeerCommandHandlers: new Map(), // Handlers registered by plugins for custom peer commands
  config: {},
  forceCloseMain: false,          // flag to allow forcing main window to close (for reload)
  translations: {},               // Store translations
  mdnsPeers: [],
  pairedPeerCache: new Map(),
  timestamp() {
    return new Date().toISOString();
  },

  log(...args) {
    if (!debugEnabled) return;
    const msg = `[${this.timestamp()}] ${args.join(' ')}\n`;
    console.log(...args);
    this.logStream?.write(msg);
  },

  warn(...args) {
    if (!debugEnabled) return;
    const msg = `[${this.timestamp()}] WARN: ${args.join(' ')}\n`;
    console.warn(...args);
    this.logStream?.write(msg);
  },

  error(...args) {
    if (!debugEnabled) return;
    const msg = `[${this.timestamp()}] ERROR: ${args.join(' ')}\n`;
    console.error(...args);
    this.logStream?.write(msg);
  },

  resetLog() {
    if (!debugEnabled) return;
    if (AppContext.logStream) {
      AppContext.logStream.end(); // close existing stream
    }

    fs.mkdirSync(path.dirname(AppContext.config.logFile), { recursive: true });

    // Truncate the file to empty it
    fs.writeFileSync(AppContext.config.logFile, '', 'utf8');

    // Reopen the stream in append mode
    AppContext.logStream = fs.createWriteStream(AppContext.config.logFile, { flags: 'a' });

  },

  callback(name, ...args) {
    if (this.callbacks[name]) {
      return this.callbacks[name](...args);
    } else {
      console.warn(`No callback registered for '${name}'`);
    }
  },

  translate(string) {
    // Search for translated string in current language
    const lang = this.config.language || 'en';
    if (this.translations[lang] && this.translations[lang][string]) {
      return this.translations[lang][string];
    }
    // Fallback to English
    if (lang !== 'en') {
      AppContext.log(`Missing translation for '${string}' in language '${lang}', falling back to English.`);
    }
    return string;
  }
}

AppContext.saveConfig = (config = AppContext.config) => {
  saveConfig(config);
};

function normalizeZoomFactor(value, fallback = 1) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(3, Math.max(0.5, parsed));
}

function applyZoomFactorToWindow(window, zoomFactor) {
  if (!window || window.isDestroyed()) return;
  const factor = normalizeZoomFactor(zoomFactor, 1);
  try {
    window.webContents.setZoomFactor(factor);
  } catch (err) {
    AppContext.error(`Failed to apply zoom factor (${factor}) to window: ${err.message}`);
  }
}

function applyZoomFactorToAllWindows(zoomFactor) {
  const factor = normalizeZoomFactor(zoomFactor, 1);
  BrowserWindow.getAllWindows().forEach((window) => applyZoomFactorToWindow(window, factor));
  return factor;
}

AppContext.applyZoomFactorToAllWindows = (zoomFactor) => {
  AppContext.config.zoomFactor = applyZoomFactorToAllWindows(zoomFactor);
  return AppContext.config.zoomFactor;
};

// Captured before loadConfig() creates the file; with firstRunCompleted this decides whether the first-run window shows.
const hadConfigAtStartup = fs.existsSync(configPath);
const cliArgs = Array.isArray(process.argv) ? process.argv : [];
const runtimeDevToolsEnabled = cliArgs.includes(RUNTIME_DEVTOOLS_FLAG)
  || app.commandLine.hasSwitch('enable-devtools');
let openPluginSettingsAfterStartup = cliArgs.includes(FIRST_RUN_PLUGIN_SETTINGS_FLAG);

// Re-reads the active profile's config from disk and re-applies everything that is not stored in it
// (command-line flags, normalized zoom, profile list). Used at startup and by the settings
// reset/delete actions, so AppContext.config never goes stale after the file on disk changes.
AppContext.reloadConfig = () => {
  const config = loadConfig();
  config.zoomFactor = normalizeZoomFactor(config.zoomFactor, 1);
  config.runtimeEnableDevTools = runtimeDevToolsEnabled;
  config.runtimeEnableDebug = debugEnabled;
  AppContext.config = config;
  AppContext.profileList = listProfiles();
  return config;
};
AppContext.reloadConfig();
if (runtimeDevToolsEnabled) {
  AppContext.log(`Runtime DevTools enabled via ${RUNTIME_DEVTOOLS_FLAG}`);
}
AppContext.currentMode = AppContext.config.mode || 'localhost';
AppContext.resetLog();
AppContext.preload = path.join(__dirname, 'preload.js');
AppContext.presentationPreload = path.join(__dirname, 'preload_presentation.js');
AppContext.handoutPreload = path.join(__dirname, 'preload_handout.js');
AppContext.hostURL = 'localhost';
AppContext.hostLANURL = serverManager.getHostURL(AppContext.config.mode);
const translationsPath = app.isPackaged
  ? path.join(process.resourcesPath, 'http_admin', 'locales', 'translations.json')
  : path.join(__dirname, 'http_admin', 'locales', 'translations.json');
AppContext.translations = JSON.parse(fs.readFileSync(translationsPath, 'utf8'));
console.log(`Loaded ${Object.keys(AppContext.translations).length} translations.`);

app.commandLine.appendSwitch('lang', AppContext.config.language || 'en');

// Helper to build server URLs with the correct protocol
function buildServerURL(host, port) {
  const protocol = AppContext.config.httpsEnabled ? 'https' : 'http';
  return `${protocol}://${host}:${port}`;
}

// Disable cert validation for localhost and private IPs when HTTPS is enabled
if (AppContext.config.httpsEnabled) {
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    try {
      const parsedUrl = new URL(url);
      const host = parsedUrl.hostname;

      const isPrivateIP = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[::1\]|\[::ffff:127\.)/.test(host);

      if (isPrivateIP) {
        event.preventDefault();
        callback(true); // Trust the certificate
      } else {
        callback(false); // Reject for non-private IPs
      }
    } catch {
      callback(false);
    }
  });
}

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


// NOTE: nothing in the repo invokes this callback or 'menu:create-main-window' (no menu item uses them).
AppContext.callbacks['menu:switch-mode'] = (mode) => {
    serverManager.switchMode(mode, AppContext, () => {
      mdnsManager.refresh(AppContext);
      if(AppContext.win) {
        AppContext.win.close();
        createMainWindow();  // Relaunch main window
      }
    });
} 

AppContext.callbacks['menu:create-main-window'] = createMainWindow;

function scheduleAlwaysOpenScreens(AppContext) {
  if (alwaysOpenStartupTimer) {
    clearTimeout(alwaysOpenStartupTimer);
    alwaysOpenStartupTimer = null;
  }
  if (!presentationWindow.shouldAutoActivatePersistentScreens?.(AppContext.config)) {
    return;
  }
  alwaysOpenStartupTimer = setTimeout(() => {
    alwaysOpenStartupTimer = null;
    presentationWindow.activateAlwaysOpenScreens(AppContext).catch((err) => {
      AppContext.error(`Failed to auto-open presentation screens: ${err.message}`);
    });
  }, 12000);
}

// deferShow: create the window hidden; the splash hand-off shows it once painted.
// initialPage: 'plugin-settings' opens Settings → Plugins instead of the presentation list.
function createMainWindow({ deferShow = false, initialPage = null } = {}) {

  const isWin = process.platform === 'win32';
  const isLinux = process.platform === 'linux';
  const isMac = process.platform === 'darwin';

  const iconPath = path.join(__dirname, 'assets', 
    isWin ? 'icon.ico' :
    isLinux ? 'icon.png' :
    'icon.png' // fallback for macOS or unknown
  );

  AppContext.log(`Creating main window with icon: ${iconPath}`);

  AppContext.win = new BrowserWindow({
    width: 1380,
    height: 820,
    icon: iconPath,
    show: !deferShow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // Optional
    },
  });

  AppContext.win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    AppContext.error(`❌ Window failed to load (${errorCode}): ${errorDescription} — ${validatedURL}`);
  });

  // Prevent closing the main window if other windows are open
  AppContext.win.on('close', (e) => {
    if (AppContext.forceCloseMain) return;

    const allWindows = BrowserWindow.getAllWindows();
    const otherOpenWindows = allWindows.filter(win =>
      win !== AppContext.win && !win.isDestroyed()
    );

    if (otherOpenWindows.length > 0) {
      if (presentationWindow.isAlwaysOpenModeActive?.()) {
        e.preventDefault();
        AppContext.log('Closing all presentation windows for app shutdown (Always Open mode).');
        AppContext.forceCloseMain = true;
        presentationWindow.markAppQuitting?.();
        for (const win of otherOpenWindows) {
          if (!win.isDestroyed()) win.close();
        }
        app.quit();
        return;
      }

      e.preventDefault();
      AppContext.log('🚫 Cannot close main window — other windows still open.');
      
      // Optional: focus one of the open windows
      otherOpenWindows[0].focus();
      AppContext.win.webContents.send('show-toast', AppContext.translate('Close other windows first.'));

      return;
    }

    if (mediaLibrary.isTranscoding && mediaLibrary.isTranscoding()) {
      const response = dialog.showMessageBoxSync(AppContext.win, {
        type: 'warning',
        buttons: [
          AppContext.translate('Keep Open'),
          AppContext.translate('Quit Anyway')
        ],
        defaultId: 0,
        cancelId: 0,
        title: AppContext.translate('Conversion in progress'),
        message: AppContext.translate('Conversion in progress'),
        detail: AppContext.translate('A high-bitrate video is still converting. Do you want to quit now and stop the conversion?')
      });
      if (response === 0) {
        e.preventDefault();
        return;
      }
      mediaLibrary.stopActiveTranscode?.();
    }
  });

  if (serverManager.viteProc) {
    AppContext.log('Vite server is already running, waiting for it to respond...');
  }

  if(!fs.existsSync(path.join(AppContext.config.presentationsDir))) {
    AppContext.error(`Presentations directory not found: ${AppContext.config.presentationsDir}`);
    splashWindow.hide(); // don't let the always-on-top splash cover the dialog
    dialog.showErrorBox('Error', `Presentations directory not found: ${AppContext.config.presentationsDir}`);
    return AppContext.win.loadURL(`data:text/html,<h1>Error</h1><p>Presentations directory not found: ${AppContext.config.presentationsDir}. Try resetting all settings.</p>`)
      .catch(() => {});
  }

  const baseURL = buildServerURL(AppContext.hostURL, AppContext.config.viteServerPort);
  const baseOrigin = new URL(baseURL).origin;
  const isExternalURL = (href) => {
    if (!href) return false;
    try {
      const parsed = new URL(href);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      return parsed.origin !== baseOrigin;
    } catch {
      return false;
    }
  };

  AppContext.win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalURL(url)) {
      shell.openExternal(url).catch((err) => {
        AppContext.error('Failed to open external URL:', err.message);
      });
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  AppContext.win.webContents.on('will-navigate', (event, url) => {
    if (isExternalURL(url)) {
      event.preventDefault();
      shell.openExternal(url).catch((err) => {
        AppContext.error('Failed to open external URL:', err.message);
      });
    }
  });
  AppContext.log(`⏳ Waiting for Vite at ${baseURL}`);
  // Resolves once the main window shows either the app or an error page;
  // the startup splash waits on it before revealing the window.
  const win = AppContext.win;
  return serverManager.waitForServer(baseURL)
    .then(async () => {
      const url = initialPage === 'plugin-settings'
        ? `${baseURL}/admin/settings.html?key=${AppContext.config.key}&tab=plugins`
        : `${baseURL}/presentations.html?key=${AppContext.config.key}`;
      AppContext.log(`✅ Vite server is ready, loading app at ${url}`);
      const result = await loadWithWatchdog(win, url, {
        AppContext,
        label: 'Main window',
        readyTimeoutMs: 20000
      });
      if (!result.ok && !result.cancelled) {
        AppContext.error('❌ Main window did not finish loading; showing it anyway.');
      }
      // AppContext.win.webContents.openDevTools()  // Uncomment for debugging
    })
    .catch((err) => {
      AppContext.error('❌ Vite server did not start in time:', err.message);
      if (!win || win.isDestroyed()) return;
      return win.loadURL(buildServerErrorPage(err.message)).catch(() => {});
    });

}  // createMainWindow

// "Server did not start" page with a Retry button (relaunches the app via
// the main window's preload API).
function buildServerErrorPage(message) {
  const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const title = escape(AppContext.translate('Server did not start'));
  const hint = escape(AppContext.translate('The computer may be busy. Close other apps if you can, then retry.'));
  const retry = escape(AppContext.translate('Retry'));
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,'Segoe UI',sans-serif;background:#120d2e;color:#fff;padding:48px}
pre{white-space:pre-wrap;opacity:.8}button{font-size:16px;padding:10px 24px;border-radius:8px;border:0;
background:#ff8b3d;color:#fff;cursor:pointer}</style></head><body>
<h1>${title}</h1><p>${hint}</p><pre>${escape(message)}</pre>
<button onclick="window.electronAPI && window.electronAPI.relaunchApp ? window.electronAPI.relaunchApp() : location.reload()">${retry}</button>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createFirstRunLanguageWindow() {
  const htmlPath = app.isPackaged
    ? path.join(process.resourcesPath, 'http_admin', 'first-run-language.html')
    : path.join(__dirname, 'http_admin', 'first-run-language.html');
  const isWin = process.platform === 'win32';
  const isLinux = process.platform === 'linux';
  const iconPath = path.join(
    __dirname,
    'assets',
    isWin ? 'icon.ico' : isLinux ? 'icon.png' : 'icon.png'
  );

  firstRunLanguageWindow = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 680,
    minHeight: 520,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#0c162a',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload_first_run.js')
    }
  });

  firstRunLanguageWindow.on('closed', () => {
    firstRunLanguageWindow = null;
  });

  firstRunLanguageWindow.loadFile(htmlPath);
}

function maybeShowFirstRunLanguagePrompt() {
  return new Promise((resolve) => {
    const shouldShowFirstRun = !hadConfigAtStartup || AppContext.config.firstRunCompleted !== true;
    if (!shouldShowFirstRun) {
      resolve(true);
      return;
    }

    splashWindow.hide();
    createFirstRunLanguageWindow();

    if (!firstRunLanguageWindow) {
      resolve(true);
      return;
    }

    let resolved = false;
    const finish = (shouldContinue) => {
      if (resolved) return;
      resolved = true;
      resolve(shouldContinue);
    };

    firstRunLanguageWindow.once('closed', () => {
      finish(false);
    });

    ipcMain.once('first-run:startup-complete', (_event, payload = {}) => {
      const relaunching = !!payload.relaunching;
      finish(!relaunching);
    });
  });
}

// Single-instance hand-off. The lock itself is taken at the top of this file.
app.on('second-instance', (_event, commandLine, workingDirectory) => {
  // A .revel file double-clicked while the app is already running arrives as argv here, and
  // opening it also brings the running instance forward.
  const revelFile = openedPresentation.findRevelFileInArgv(commandLine, workingDirectory);
  if (revelFile) {
    openedPresentation.handleOpenRequest(AppContext, revelFile);
    return;
  }

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

app.whenReady().then(async () => {
  app.on('browser-window-created', (_event, window) => {
    if (!window || window.isDestroyed()) return;
    applyZoomFactorToWindow(window, AppContext.config.zoomFactor);
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
    AppContext.log('⚠️ FFmpeg binary not found. Video/audio features may not work. Configure ffmpegPath in settings or ensure ffmpeg is installed.');
  }

  const shouldContinueStartup = await maybeShowFirstRunLanguagePrompt();
  if (!shouldContinueStartup) {
    splashWindow.close();
    app.quit();
    return;
  }
  splashWindow.unhide();

  try {
    const appVersion = app.getVersion();
    const docsCurrent = isDocumentationPresentationCurrent({
      presentationsDir: AppContext.config.presentationsDir,
      appVersion
    });
    if (docsCurrent) {
      const manifestPath = getDocsManifestPath(AppContext.config.presentationsDir);
      AppContext.log(`📝 Documentation presentation up to date for app version ${appVersion} (${manifestPath})`);
    } else {
      // Ensure presentations directory is writable before generating docs (handles OneDrive sync delays)
      try {
        fs.mkdirSync(AppContext.config.presentationsDir, { recursive: true });
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }

      const docsResult = generateDocumentationPresentations({
        presentationsDir: AppContext.config.presentationsDir,
        revelationDir: AppContext.config.revelationDir,
        wrapperRoot: __dirname,
        appVersion
      });
      AppContext.log(`📝 Documentation presentation ready: ${docsResult.generatedCount} files (${docsResult.readmePresDir})`);
    }
  } catch (err) {
    AppContext.error(`Failed to prepare documentation presentation: ${err.message}`);
  }

  await serverManager.startServers(AppContext.config.mode, AppContext);
  serverManager.startIPWatcher(AppContext);
  mdnsManager.refresh(AppContext);
  peerCommandClient.start(AppContext);
  await apiServer.start(AppContext);
  openedPresentation.cleanupOnStartup(AppContext);
  const mainWindowReady = createMainWindow({
    deferShow: true,
    initialPage: openPluginSettingsAfterStartup ? 'plugin-settings' : null
  });
  openPluginSettingsAfterStartup = false;
  splashWindow.handOffTo(AppContext.win, mainWindowReady);
  openedPresentation.flushPending(AppContext);
  // Linux: electron-builder cannot set a .revel file icon, so install it per user. Delayed so it
  // never competes with startup, and limited to packaged builds (or REVELATION_FORCE_FILE_ICON=1)
  // so development runs do not touch the user's MIME database.
  if (process.platform === 'linux' && (app.isPackaged || process.env.REVELATION_FORCE_FILE_ICON === '1')) {
    setTimeout(() => {
      const iconSource = [
        path.join(process.resourcesPath || '', 'file-icon.png'),
        path.join(__dirname, 'build-resources', 'file-icon.png')
      ].find((candidate) => fs.existsSync(candidate));
      ensureLinuxFileIcon({
        iconSource,
        appVersion: app.getVersion(),
        stampPath: path.join(app.getPath('userData'), 'linux-file-icon.json'),
        log: (message) => AppContext.log(message)
      }).then((result) => {
        if (result.status === 'installed') AppContext.log('🖼️ Installed the .revel file icon for this user');
      }).catch((err) => AppContext.log(`⚠️ Could not install the .revel file icon: ${err.message}`));
    }, 5000);
  }
  // Once the window has been shown, later open requests open immediately and bring it forward.
  if (AppContext.win.isVisible()) {
    openedPresentation.markReady(AppContext);
  } else {
    AppContext.win.once('show', () => openedPresentation.markReady(AppContext));
  }
  AppContext.config.zoomFactor = applyZoomFactorToAllWindows(AppContext.config.zoomFactor);
  presentationWindow.syncUrlPublishForConfig?.(AppContext);
  scheduleAlwaysOpenScreens(AppContext);
  const translatedMenu = translateMenu(AppContext.mainMenuTemplate, AppContext);
  const mainMenu = Menu.buildFromTemplate(translatedMenu);
  Menu.setApplicationMenu(mainMenu); 
  setTimeout(() => {
    checkForUpdates(AppContext).catch((err) => {
      AppContext.error('Update check error:', err.message);
    });
  }, 1500);
});

app.on('before-quit', () => {
  if (alwaysOpenStartupTimer) {
    clearTimeout(alwaysOpenStartupTimer);
    alwaysOpenStartupTimer = null;
  }
  presentationWindow.markAppQuitting?.();
  mdnsManager.stop(AppContext);
  peerCommandClient.stop();
  apiServer.stop();
  serverManager.stopIPWatcher();
  serverManager.stopServers(AppContext);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

function translateMenu(menuTemplate, appContext) {
  // Recursively translate menu items
  return menuTemplate.map(item => {
    const newItem = { ...item };
    if (newItem.label) {
      newItem.label = appContext.translate(newItem.label);
    }
    if (newItem.submenu) {
      newItem.submenu = translateMenu(newItem.submenu, appContext);
    }
    return newItem;
  });
}

// Used by IPC "reload-servers" and the settingsWindow reset/delete actions: force-restarts Vite
// (serverManager.switchMode), rebuilds the menu and plugin list, closes and recreates the main window.
// It does NOT re-read config.json; call AppContext.reloadConfig() first if the file changed.
AppContext.reloadServers = async () => {
  AppContext.log('Reloading servers...');
  AppContext.forceCloseMain = true; 

  await serverManager.switchMode(AppContext.config.mode, AppContext,  () => {
      if (alwaysOpenStartupTimer) {
        clearTimeout(alwaysOpenStartupTimer);
        alwaysOpenStartupTimer = null;
      }
      AppContext.mainMenuTemplate = [];
      mainMenu.register(ipcMain,AppContext);
      pluginDirector.populatePlugins(AppContext);
      pluginDirector.writePluginsIndex(AppContext);
      mdnsManager.refresh(AppContext);
      if(AppContext.win) {
        AppContext.win.close();
        createMainWindow();  // Relaunch main window
        AppContext.config.zoomFactor = applyZoomFactorToAllWindows(AppContext.config.zoomFactor);
        presentationWindow.syncUrlPublishForConfig?.(AppContext);
        scheduleAlwaysOpenScreens(AppContext);
        const translatedMenu = translateMenu(AppContext.mainMenuTemplate, AppContext);
        const mainMenu = Menu.buildFromTemplate(translatedMenu);
        Menu.setApplicationMenu(mainMenu); 
      }
    }, true); // Force reload

  AppContext.forceCloseMain = false;
  AppContext.log('Servers reloaded successfully');
}

// Packaged builds only matter here (process.resourcesPath): copies/re-syncs bundled revelation and
// plugins into <userData>/resources. configManager.defaultRevelationDir prefers that mirror when it exists.
// User-installed plugins survive: only entries recorded in .sync-state.json as bundled are pruned.
function ensureWritableResources() {
  const userDataDir = app.getPath('userData');
  const userResources = path.join(userDataDir, 'resources');
  const userRevelation = path.join(userResources, 'revelation');
  const userPlugins = path.join(userResources, 'plugins');
  const appRevelation = path.join(process.resourcesPath, 'revelation');
  const appPlugins = path.join(process.resourcesPath, 'plugins');
  const appPkg = path.join(appRevelation, 'package.json');
  const userPkg = path.join(userRevelation, 'package.json');
  const syncStatePath = path.join(userResources, '.sync-state.json');

  // If system folder is not writable (typical on Linux /opt)
  let writable = true;
  try {
    fs.accessSync(process.resourcesPath, fs.constants.W_OK);
    console.log(`System resources path is writable: ${process.resourcesPath}`);
  } catch {
    writable = false;
  }

  const hasUserMirror = fs.existsSync(userRevelation) || fs.existsSync(userPlugins);
  const shouldUseUserResources = !writable || hasUserMirror;
  if (!shouldUseUserResources) return;

  if (!writable) {
    console.log(`System resources path is not writable: ${process.resourcesPath}`);
  } else {
    console.log(`System resources path is writable, but existing user resource mirror found.`);
  }
  console.log(`Using user resources path: ${userResources}`);
  fs.mkdirSync(userResources, { recursive: true });

  try {
    if (!fs.existsSync(userRevelation) && fs.existsSync(appRevelation)) {
      fsExtra.copySync(appRevelation, userRevelation, { overwrite: false });
      console.log('📦 Copied revelation to user resources folder.');
    }
    if (!fs.existsSync(userPlugins) && fs.existsSync(appPlugins)) {
      fsExtra.copySync(appPlugins, userPlugins, { overwrite: false });
      console.log('📦 Copied plugins to user resources folder.');
    }

    if (!fs.existsSync(appPkg)) return;

    const syncState = readJsonSafe(syncStatePath) || {};
    const appVer = String((readJsonSafe(appPkg) || {}).version || '').trim();
    if (!appVer) return;

    let userVer = '0.0.0';
    const userPkgJson = readJsonSafe(userPkg);
    if (userPkgJson && typeof userPkgJson.version === 'string' && userPkgJson.version.trim()) {
      userVer = userPkgJson.version.trim();
    } else if (typeof syncState.revelationVersion === 'string' && syncState.revelationVersion.trim()) {
      userVer = syncState.revelationVersion.trim();
    }

    const runtimeProbeFiles = [
      path.join(userRevelation, 'package.json'),
      path.join(userRevelation, 'node_modules', 'vite', 'bin', 'vite.js'),
      path.join(userRevelation, 'node_modules', 'reveal.js-remote', 'server', 'index.js')
    ];
    const missingRuntimeFiles = runtimeProbeFiles.filter((probePath) => !fs.existsSync(probePath));
    const needsRuntimeRepair = missingRuntimeFiles.length > 0;

    if (appVer !== userVer || needsRuntimeRepair) {
      if (needsRuntimeRepair) {
        console.log(`🔧 Missing runtime files in user mirror; syncing updates...`);
      } else {
        console.log(`🔄 Revelation version changed (${userVer} → ${appVer}), syncing updates...`);
      }
      replaceDirectory(appRevelation, userRevelation);
      const bundledEntries = syncBundledPlugins(
        appPlugins,
        userPlugins,
        Array.isArray(syncState.bundledPluginEntries) ? syncState.bundledPluginEntries : []
      );
      writeSyncState(syncStatePath, {
        revelationVersion: appVer,
        bundledPluginEntries: bundledEntries,
        syncedAt: new Date().toISOString()
      });
      console.log('✅ User resources updated.');
      return;
    }

    // Keep sync metadata populated for recovery and future stale-plugin pruning.
    const currentBundledEntries = listEntryNames(appPlugins);
    if (
      !Array.isArray(syncState.bundledPluginEntries) ||
      syncState.revelationVersion !== appVer
    ) {
      writeSyncState(syncStatePath, {
        revelationVersion: appVer,
        bundledPluginEntries: currentBundledEntries,
        syncedAt: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error(`❌ Failed to sync user resources: ${err.message}`);
    console.error('Continuing startup with available resources.');
  }
}

function ensureAppNodeModulesOnPath() {
  const appNodeModules = path.join(app.getAppPath(), 'node_modules');
  if (!fs.existsSync(appNodeModules)) return;

  const existing = process.env.NODE_PATH
    ? process.env.NODE_PATH.split(path.delimiter).filter(Boolean)
    : [];
  if (existing.includes(appNodeModules)) return;

  process.env.NODE_PATH = [...existing, appNodeModules].join(path.delimiter);
  Module._initPaths();
  console.log(`Added app node_modules to NODE_PATH: ${appNodeModules}`);
}

function syncBundledPlugins(appPlugins, userPlugins, previousBundledEntries = []) {
  if (!fs.existsSync(appPlugins)) return [];
  fs.mkdirSync(userPlugins, { recursive: true });

  const bundledEntryNames = listEntryNames(appPlugins);
  const previouslyBundled = new Set(previousBundledEntries);
  const currentlyBundled = new Set(bundledEntryNames);

  // Remove entries that used to be bundled but are no longer bundled now.
  for (const name of previouslyBundled) {
    if (currentlyBundled.has(name)) continue;
    const stalePath = path.join(userPlugins, name);
    if (fs.existsSync(stalePath)) {
      fs.rmSync(stalePath, { recursive: true, force: true });
    }
  }

  // Replace every currently bundled plugin entry while preserving user-only entries.
  for (const name of bundledEntryNames) {
    const srcPath = path.join(appPlugins, name);
    const destPath = path.join(userPlugins, name);

    if (fs.existsSync(destPath)) {
      fs.rmSync(destPath, { recursive: true, force: true });
    }
    fsExtra.copySync(srcPath, destPath, { overwrite: true, errorOnExist: false });
  }

  return bundledEntryNames;
}

function replaceDirectory(sourcePath, destPath) {
  if (!fs.existsSync(sourcePath)) return;
  const tmpPath = `${destPath}.tmp-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (fs.existsSync(tmpPath)) {
    fs.rmSync(tmpPath, { recursive: true, force: true });
  }
  fsExtra.copySync(sourcePath, tmpPath, { overwrite: true, errorOnExist: false });
  if (fs.existsSync(destPath)) {
    fs.rmSync(destPath, { recursive: true, force: true });
  }
  fs.renameSync(tmpPath, destPath);
}

function listEntryNames(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => entry.name);
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeSyncState(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

ipcMain.handle('reload-servers', AppContext.reloadServers);
ipcMain.handle('first-run:get-state', () => {
  const availableLanguages = Array.from(
    new Set(['en', ...Object.keys(AppContext.translations || {})])
  ).sort();
  const defaultLanguage = String(AppContext.config.language || 'en').trim().toLowerCase() || 'en';
  return {
    availableLanguages,
    defaultLanguage,
    platform: process.platform,
    translations: AppContext.translations || {},
    popplerDownloadAvailable: !!popplerPluginDownload(),
    popplerPluginInstalled: popplerPayloadInstalled()
      && Array.isArray(AppContext.config.plugins)
      && AppContext.config.plugins.includes('popplerpdf')
  };
});

// True when the popplerpdf plugin holds a Poppler build for this machine (a
// dev checkout has the plugin source but no payload).
function popplerPayloadInstalled() {
  try {
    const pluginDir = path.join(pluginDirector.resolvePluginFolder(AppContext), 'popplerpdf');
    const plugin = require(path.join(pluginDir, 'plugin.js'));
    return !!plugin.findPopplerRoot(pluginDir);
  } catch (_err) {
    return false;
  }
}

// PDF import on Windows and macOS: the PopplerPDF plugin ZIPs published with
// each release (built by build-popplerpdf-win/-mac + dist-popplerpdf). Each
// entry's sha256 must match that exact file; a download that doesn't is
// refused. Update the URL and hash together whenever a ZIP is rebuilt.
// (a download whose sha256 differs is refused by pluginDirector.installPluginFromUrl)
const POPPLER_PLUGIN_RELEASE = 'https://github.com/fiforms/revelation-electron-wrapper/releases/download/v1.0.12';
const POPPLER_PLUGIN_DOWNLOADS = {
  'win32-x64': {
    url: `${POPPLER_PLUGIN_RELEASE}/PopplerPDF.Plugin.26.09.for.REVELation.Windows-x64.zip`,
    sha256: 'd62c1ccb0c66117812848f5e8054a18fc61fd791ba504b47320f7ab32f8232f4'
  },
  'darwin-arm64': {
    url: `${POPPLER_PLUGIN_RELEASE}/PopplerPDF.Plugin.26.09.for.REVELation.macOS-arm64.zip`,
    sha256: '3fadacd2418eb915af7ab5d640c77fd0099ee2fcfc986aae162dfde99fe84307'
  },
  'darwin-x64': {
    url: `${POPPLER_PLUGIN_RELEASE}/PopplerPDF.Plugin.26.09.for.REVELation.macOS-x64.zip`,
    sha256: '3c82c09f4b3fc58487a9e2bb8778a31ffb57fc0a4c65f2e10419ab123f39cb7d'
  }
};
// Windows on ARM runs the x64 build under emulation.
POPPLER_PLUGIN_DOWNLOADS['win32-arm64'] = POPPLER_PLUGIN_DOWNLOADS['win32-x64'];

function popplerPluginDownload() {
  const download = POPPLER_PLUGIN_DOWNLOADS[`${process.platform}-${process.arch}`];
  // No hash yet means the ZIP has not been published; don't offer it.
  return download && download.sha256 ? download : null;
}

let popplerInstallInProgress = false;
ipcMain.handle('first-run:install-poppler', async (event) => {
  const download = popplerPluginDownload();
  if (!download) {
    return { success: false, error: 'The PopplerPDF plugin is not available for this system.' };
  }
  if (popplerInstallInProgress) {
    return { success: false, error: 'Installation is already running.' };
  }
  popplerInstallInProgress = true;
  const sender = event.sender;
  let lastSent = 0;
  try {
    const result = await pluginDirector.installPluginFromUrl(AppContext, download.url, {
      expectedId: 'popplerpdf',
      expectedSha256: download.sha256,
      onProgress: ({ received, total }) => {
        const now = Date.now();
        if (now - lastSent < 150 && received !== total) return;
        lastSent = now;
        if (!sender.isDestroyed()) sender.send('first-run:install-progress', { received, total });
      }
    });
    return { success: true, version: result.pluginVersion };
  } catch (err) {
    AppContext.error(`PopplerPDF plugin install failed: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    popplerInstallInProgress = false;
  }
});

// Links the first-run setup page may open in the system browser.
const FIRST_RUN_LINKS = {
  releases: 'https://github.com/fiforms/revelation-electron-wrapper/releases',
  libreoffice: 'https://www.libreoffice.org/download/download-libreoffice/',
  homebrew: 'https://brew.sh/'
};

ipcMain.handle('first-run:open-link', (_event, payload = {}) => {
  const url = FIRST_RUN_LINKS[payload.link];
  if (!url) return { success: false };
  shell.openExternal(url).catch((err) => {
    AppContext.error('Failed to open external URL:', err.message);
  });
  return { success: true };
});

ipcMain.handle('first-run:complete', (event, payload = {}) => {
  const selectedLanguage = String(payload.language || 'en').trim().toLowerCase() || 'en';
  const previousLanguage = String(AppContext.config.language || 'en').trim().toLowerCase() || 'en';
  const openPluginSettings = payload.openPluginSettings === true;
  AppContext.config.language = selectedLanguage;
  AppContext.config.firstRunCompleted = true;
  saveConfig(AppContext.config);

  const relaunching = selectedLanguage !== previousLanguage;
  if (openPluginSettings && !relaunching) {
    openPluginSettingsAfterStartup = true;
  }
  ipcMain.emit('first-run:startup-complete', event, { relaunching });

  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.close();
  }

  if (relaunching) {
    const args = process.argv.slice(1).filter((arg) => arg !== FIRST_RUN_PLUGIN_SETTINGS_FLAG);
    if (openPluginSettings) args.push(FIRST_RUN_PLUGIN_SETTINGS_FLAG);
    app.relaunch({ args });
    app.exit(0);
  }

  return { success: true, relaunching };
});

ipcMain.handle('first-run:cancel', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.close();
  }
  return { success: true };
});

ipcMain.handle('relaunch-app', () => {
  app.relaunch();
  app.exit(0);
  return { success: true, relaunching: true };
});
