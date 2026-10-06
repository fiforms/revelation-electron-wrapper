/**
 * appContext.js -- builds the shared AppContext object and owns the zoom-factor helpers.
 *
 * createAppContext({ debugEnabled, runtimeDevToolsEnabled }) returns the single object that main.js hands to
 * every module's register(ipcMain, AppContext). Fields (win, hostURL, hostLANURL, config, preload paths,
 * mainMenuTemplate, callbacks, plugins, translations, mdnsPeers, ...) are documented in the main.js header.
 * Methods: log/warn/error (no-ops unless --enable-debug; also written to config.logFile), resetLog,
 * callback(name, ...args),
 * translate(string), saveConfig, reloadConfig, applyZoomFactorToAllWindows.
 * reloadConfig() re-reads the active profile from disk and re-applies what is not stored in it (command-line
 * flags, normalized zoom, profile list); used at startup and by the settings reset/delete actions.
 * AppContext.reloadServers is added by main.js (it needs the main window and menu).
 *
 * Also exports normalizeZoomFactor, applyZoomFactorToWindow, applyZoomFactorToAllWindows
 * (a copy of normalizeZoomFactor still lives in otherEventHandlers.js; REFACTOR_CANDIDATES D5).
 */

const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { loadConfig, saveConfig, listProfiles } = require('./configManager');

function normalizeZoomFactor(value, fallback = 1) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(3, Math.max(0.5, parsed));
}

// `logger` needs an error() method (AppContext has one); defaults to console.
function applyZoomFactorToWindow(window, zoomFactor, logger = console) {
  if (!window || window.isDestroyed()) return;
  const factor = normalizeZoomFactor(zoomFactor, 1);
  try {
    window.webContents.setZoomFactor(factor);
  } catch (err) {
    logger.error(`Failed to apply zoom factor (${factor}) to window: ${err.message}`);
  }
}

function applyZoomFactorToAllWindows(zoomFactor, logger = console) {
  const factor = normalizeZoomFactor(zoomFactor, 1);
  BrowserWindow.getAllWindows().forEach((window) => applyZoomFactorToWindow(window, factor, logger));
  return factor;
}

function createAppContext({ debugEnabled, runtimeDevToolsEnabled }) {
  const AppContext = {
    win: null,                      // Main application window
    hostURL: null,                  // Host URL (always localhost for app screens)
    hostLANURL: null,               // Host URL for LAN-accessible presentation URLs
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
  };

  AppContext.saveConfig = (config = AppContext.config) => {
    saveConfig(config);
  };

  AppContext.applyZoomFactorToAllWindows = (zoomFactor) => {
    AppContext.config.zoomFactor = applyZoomFactorToAllWindows(zoomFactor, AppContext);
    return AppContext.config.zoomFactor;
  };

  // Re-reads the active profile's config from disk and re-applies everything that is not stored in it.
  AppContext.reloadConfig = () => {
    const config = loadConfig();
    config.zoomFactor = normalizeZoomFactor(config.zoomFactor, 1);
    config.runtimeEnableDevTools = runtimeDevToolsEnabled;
    config.runtimeEnableDebug = debugEnabled;
    AppContext.config = config;
    AppContext.profileList = listProfiles();
    return config;
  };

  return AppContext;
}

module.exports = {
  createAppContext,
  normalizeZoomFactor,
  applyZoomFactorToWindow,
  applyZoomFactorToAllWindows
};
