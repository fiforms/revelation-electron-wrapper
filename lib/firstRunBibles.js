/**
 * firstRunBibles.js -- the Bible downloads offered by the first-run setup ("Bible Collection" and the NET Bible).
 *
 * The download and conversion code is the Bible Text plugin's (plugins/bibletext/bibleDownloader.js); this module only
 * exposes it to the first-run window. The setup runs before any plugin is loaded, so it cannot go through
 * plugin-trigger: the module is required straight from the plugin folder, as downloadablePluginInstaller.js does
 * for a plugin's hasPayload(). When the plugin is missing or disabled, nothing is offered (getState().available is false).
 * Exports: getState(AppContext), register(ipcMain, AppContext).
 * IPC: first-run:get-bible-groups({ language }) -> the collection's language groups (checkboxes) and which to tick;
 *   first-run:install-bibles({ id, groups }) with id "collection" or "net" (sends first-run:install-progress
 *   { received, total, phase, label } to the caller, the same channel the plugin installer uses).
 * Callers: lib/firstRunWizard.js (register, and getState for first-run:get-state).
 * Gotcha: downloads go to <userData>/bibles, not the plugin folder (an installed app's resources are read-only);
 *   the plugin reads both folders. Only one Bible download runs at a time (bibleDownloader.js).
 */

const path = require('path');
const { app } = require('electron');
const { pluginDirector } = require('./pluginDirector');

function loadDownloader(AppContext) {
  if (!Array.isArray(AppContext.config.plugins) || !AppContext.config.plugins.includes('bibletext')) return null;
  try {
    const pluginFolder = pluginDirector.resolvePluginFolder(AppContext);
    return require(path.join(pluginFolder, 'bibletext', 'bibleDownloader.js'));
  } catch (_err) {
    return null;
  }
}

// { available, collection: { installed }, net: { installed } } for first-run:get-state.
function getState(AppContext) {
  const downloader = loadDownloader(AppContext);
  if (!downloader) return { available: false };
  return { available: true, ...downloader.getStatus(downloader.userBiblesDir(app.getPath('userData'))) };
}

function register(ipcMain, AppContext) {
  // The collection's language groups for the checkboxes. The page passes the language chosen on its first screen
  // (it is not saved yet) so the right groups are ticked first. Needs the network; an error is shown with a retry.
  ipcMain.handle('first-run:get-bible-groups', async (_event, payload = {}) => {
    const downloader = loadDownloader(AppContext);
    if (!downloader) return { success: false, error: 'Bible downloads are not available.' };
    try {
      const groups = await downloader.getCollectionGroups({
        skipNames: downloader.listBibleBaseNames(downloader.bundledBiblesDir(pluginDirector.resolvePluginFolder(AppContext)))
      });
      const installed = new Set(downloader.getStatus(downloader.userBiblesDir(app.getPath('userData'))).collection.groups);
      return {
        success: true,
        groups: groups.map((g) => ({ ...g, installed: installed.has(g.id) })),
        defaults: downloader.defaultGroups(payload.language)
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('first-run:install-bibles', async (event, payload = {}) => {
    const { id, groups } = payload;
    const downloader = loadDownloader(AppContext);
    if (!downloader) return { success: false, error: 'Bible downloads are not available.' };
    const sender = event.sender;
    let lastSent = 0;
    try {
      await downloader.install(String(id || ''), {
        destDir: downloader.userBiblesDir(app.getPath('userData')),
        groups,
        skipNames: downloader.listBibleBaseNames(downloader.bundledBiblesDir(pluginDirector.resolvePluginFolder(AppContext))),
        log: (message) => AppContext.log(`[bibles] ${message}`),
        onProgress: ({ received, total, phase, label }) => {
          const now = Date.now();
          if (now - lastSent < 150 && !(total && received === total) && phase !== 'converting') return;
          lastSent = now;
          if (!sender.isDestroyed()) sender.send('first-run:install-progress', { received, total, phase, label });
        }
      });
      return { success: true };
    } catch (err) {
      AppContext.error(`Bible download failed (${id}): ${err.message}`);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { getState, register };
