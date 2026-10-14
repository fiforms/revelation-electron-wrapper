/**
 * downloadablePlugins.js -- loader for lib/downloadablePlugins.json, the catalog of plugins that are NOT
 * bundled in some builds and are offered for download (with a pinned SHA-256) from the first-run setup.
 *
 * Why a catalog in core and not a manifest inside the plugin: packaged builds strip the plugin folder
 * (scripts/prepackage.js), so its own files are absent exactly when the download is offered. The plugin
 * ids live in that data file only; no code here or in the installer names a plugin.
 *
 * Entry shape (downloadablePlugins.json):
 *   id        plugin id; must match the ZIP's plugin-manifest.json id (installPluginFromUrl enforces it)
 *   slot      capability the first-run page shows it under (e.g. "pdf-import"); the page names the slot, not the plugin
 *   release   https URL of the release tag that hosts the ZIPs
 *   downloads { "<process.platform>-<process.arch>": { file, sha256 } }; an empty sha256 = "not published yet", not offered
 *   aliases   { "<platform-arch>": "<other key>" } for machines that run another build (e.g. Windows ARM -> x64)
 * Optional plugin hook (plugin.js): hasPayload(pluginDir) -> boolean, so a plugin whose source ships without
 * its binaries (a dev checkout) is not reported as installed. Used by downloadablePluginInstaller.js.
 *
 * WHEN YOU REBUILD OR REPUBLISH THE ZIPs (see plugins/popplerpdf/README.md):
 *   1. Set `release` to the GitHub release tag that hosts the ZIPs.
 *   2. Update `file` (version part) and `sha256` of every platform entry.
 *      Hash a file with:  sha256sum <file>   (Linux)   |   shasum -a 256 <file>   (macOS)
 * A download whose hash differs is refused (lib/pluginDirector.js installPluginFromUrl).
 *
 * Exports: listDownloadablePlugins(), findDownloadablePlugin(id), getDownload(entry, platform?, arch?).
 * Callers: lib/downloadablePluginInstaller.js (download + install), lib/firstRunWizard.js (offers it or not).
 */

const catalog = require('./downloadablePlugins.json');

function listDownloadablePlugins() {
  return Array.isArray(catalog.plugins) ? catalog.plugins : [];
}

function findDownloadablePlugin(id) {
  return listDownloadablePlugins().find((entry) => entry.id === id) || null;
}

// The { url, sha256 } for this machine, or null when none is published for it.
function getDownload(entry, platform = process.platform, arch = process.arch) {
  if (!entry || !entry.downloads) return null;
  let key = `${platform}-${arch}`;
  if (!entry.downloads[key] && entry.aliases && entry.aliases[key]) key = entry.aliases[key];
  const download = entry.downloads[key];
  if (!download || !download.sha256 || !download.file) return null;
  return { url: `${entry.release}/${download.file}`, sha256: download.sha256 };
}

module.exports = { listDownloadablePlugins, findDownloadablePlugin, getDownload };
