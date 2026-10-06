/**
 * mainWindow.js -- the main application window (library / Settings) and the application menu.
 *
 * createMainWindow(AppContext, { deferShow, initialPage }): BrowserWindow with preload.js that loads
 *   /presentations.html (or /admin/settings.html?tab=plugins for initialPage 'plugin-settings') from the Vite
 *   server once it answers, via loadWithWatchdog. deferShow creates it hidden for the splash hand-off.
 *   Returns a promise that resolves when the window shows the app or an error page. The window refuses to
 *   close while other windows are open (unless Always Open mode, which closes them all and quits) and warns
 *   about a running transcode. External links open in the system browser.
 * buildServerErrorPage(AppContext, message): data: URL for the "Server did not start" page with a Retry button
 *   (calls electronAPI.relaunchApp from preload.js).
 * applyApplicationMenu(AppContext): translates AppContext.mainMenuTemplate and installs it.
 * scheduleAlwaysOpenScreens(AppContext) / cancelAlwaysOpenScreens(): open the persistent presentation screens
 *   12 s after startup (or after a server reload), when the config asks for it.
 *
 * Callers: main.js (startup, reloadServers, the macOS 'activate' handler, menu callbacks).
 * IPC: none (the Retry button uses relaunch-app in main.js).
 */

const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { buildServerURL } = require('./serverUrl');
const { splashWindow } = require('./splashWindow');
const { loadWithWatchdog } = require('./loadWatchdog');
const { serverManager } = require('./serverManager');
const { presentationWindow } = require('./presentationWindow');
const { mediaLibrary } = require('./mediaLibrary');

const ALWAYS_OPEN_DELAY_MS = 12000;
let alwaysOpenStartupTimer = null;

function cancelAlwaysOpenScreens() {
  if (alwaysOpenStartupTimer) {
    clearTimeout(alwaysOpenStartupTimer);
    alwaysOpenStartupTimer = null;
  }
}

function scheduleAlwaysOpenScreens(AppContext) {
  cancelAlwaysOpenScreens();
  if (!presentationWindow.shouldAutoActivatePersistentScreens?.(AppContext.config)) {
    return;
  }
  alwaysOpenStartupTimer = setTimeout(() => {
    alwaysOpenStartupTimer = null;
    presentationWindow.activateAlwaysOpenScreens(AppContext).catch((err) => {
      AppContext.error(`Failed to auto-open presentation screens: ${err.message}`);
    });
  }, ALWAYS_OPEN_DELAY_MS);
}

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

function applyApplicationMenu(AppContext) {
  const translatedMenu = translateMenu(AppContext.mainMenuTemplate, AppContext);
  Menu.setApplicationMenu(Menu.buildFromTemplate(translatedMenu));
}

// deferShow: create the window hidden; the splash hand-off shows it once painted.
// initialPage: 'plugin-settings' opens Settings → Plugins instead of the presentation list.
function createMainWindow(AppContext, { deferShow = false, initialPage = null } = {}) {

  const isWin = process.platform === 'win32';
  const isLinux = process.platform === 'linux';
  const isMac = process.platform === 'darwin';

  const iconPath = path.join(__dirname, '..', 'assets',
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
      preload: path.join(__dirname, '..', 'preload.js'), // Optional
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
        detail: AppContext.translate(
          'A high-bitrate video is still converting. Do you want to quit now and stop the conversion?'
        )
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
    const missingDirPage = `data:text/html,<h1>Error</h1><p>Presentations directory not found: ` +
      `${AppContext.config.presentationsDir}. Try resetting all settings.</p>`;
    return AppContext.win.loadURL(missingDirPage).catch(() => {});
  }

  const baseURL = buildServerURL(AppContext.hostURL, AppContext.config.viteServerPort, AppContext.config.httpsEnabled);
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
      return win.loadURL(buildServerErrorPage(AppContext, err.message)).catch(() => {});
    });

}  // createMainWindow

// "Server did not start" page with a Retry button (relaunches the app via
// the main window's preload API).
function buildServerErrorPage(AppContext, message) {
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
<button onclick="window.electronAPI && window.electronAPI.relaunchApp
  ? window.electronAPI.relaunchApp() : location.reload()">${retry}</button>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

module.exports = {
  createMainWindow,
  buildServerErrorPage,
  applyApplicationMenu,
  scheduleAlwaysOpenScreens,
  cancelAlwaysOpenScreens
};
