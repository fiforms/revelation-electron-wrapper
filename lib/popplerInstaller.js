/**
 * popplerInstaller.js -- downloads and installs the PopplerPDF plugin from the first-run setup.
 *
 * The URLs and SHA-256 hashes are NOT here; they are release data in lib/popplerRelease.js.
 * Exports: isPayloadInstalled(AppContext), register(ipcMain, AppContext).
 * IPC: first-run:install-poppler (sends first-run:install-progress { received, total } to the caller).
 * Callers: lib/firstRunWizard.js (register, and isPayloadInstalled for first-run:get-state).
 * Gotcha: installPluginFromUrl in pluginDirector refuses a ZIP whose hash differs or whose id is not popplerpdf.
 */

const path = require('path');
const { pluginDirector } = require('./pluginDirector');
const { getPopplerPluginDownload } = require('./popplerRelease');

let installInProgress = false;

// True when the popplerpdf plugin holds a Poppler build for this machine (a
// dev checkout has the plugin source but no payload).
function isPayloadInstalled(AppContext) {
  try {
    const pluginDir = path.join(pluginDirector.resolvePluginFolder(AppContext), 'popplerpdf');
    const plugin = require(path.join(pluginDir, 'plugin.js'));
    return !!plugin.findPopplerRoot(pluginDir);
  } catch (_err) {
    return false;
  }
}

function register(ipcMain, AppContext) {
  ipcMain.handle('first-run:install-poppler', async (event) => {
    const download = getPopplerPluginDownload();
    if (!download) {
      return { success: false, error: 'The PopplerPDF plugin is not available for this system.' };
    }
    if (installInProgress) {
      return { success: false, error: 'Installation is already running.' };
    }
    installInProgress = true;
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
      installInProgress = false;
    }
  });
}

module.exports = { isPayloadInstalled, register };
