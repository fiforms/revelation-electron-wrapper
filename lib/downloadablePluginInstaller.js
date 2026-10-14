/**
 * downloadablePluginInstaller.js -- downloads and installs a catalogued plugin from the first-run setup.
 *
 * The plugin ids, URLs and SHA-256 hashes are NOT here; they are release data in lib/downloadablePlugins.json
 * (see lib/downloadablePlugins.js).
 * Exports: isPayloadInstalled(AppContext, entry), register(ipcMain, AppContext).
 * IPC: first-run:install-plugin(id) (sends first-run:install-progress { received, total } to the caller).
 * Callers: lib/firstRunWizard.js (register, and isPayloadInstalled for first-run:get-state).
 * Gotcha: installPluginFromUrl in pluginDirector refuses a ZIP whose hash differs or whose id is not the catalog id.
 */

const path = require('path');
const { pluginDirector } = require('./pluginDirector');
const { findDownloadablePlugin, getDownload } = require('./downloadablePlugins');

let installInProgress = false;

// True when the plugin folder holds what the plugin needs on this machine. A plugin may expose
// hasPayload(pluginDir) for that (a dev checkout has the source but no binaries); without the hook,
// a plugin folder that loads counts as installed.
function isPayloadInstalled(AppContext, entry) {
  try {
    const pluginDir = path.join(pluginDirector.resolvePluginFolder(AppContext), entry.id);
    const plugin = require(path.join(pluginDir, 'plugin.js'));
    return typeof plugin.hasPayload === 'function' ? !!plugin.hasPayload(pluginDir) : true;
  } catch (_err) {
    return false;
  }
}

function register(ipcMain, AppContext) {
  ipcMain.handle('first-run:install-plugin', async (event, id) => {
    const entry = findDownloadablePlugin(String(id || ''));
    const download = getDownload(entry);
    if (!entry || !download) {
      return { success: false, error: 'This plugin is not available for download on this system.' };
    }
    if (installInProgress) {
      return { success: false, error: 'Installation is already running.' };
    }
    installInProgress = true;
    const sender = event.sender;
    let lastSent = 0;
    try {
      const result = await pluginDirector.installPluginFromUrl(AppContext, download.url, {
        expectedId: entry.id,
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
      AppContext.error(`Plugin install failed (${entry.id}): ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      installInProgress = false;
    }
  });
}

module.exports = { isPayloadInstalled, register };
