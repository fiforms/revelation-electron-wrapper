/**
 * popplerRelease.js -- RELEASE DATA for the downloadable PopplerPDF plugin. Edit this file per release.
 *
 * Windows and macOS builds do not bundle Poppler (PDF import). The first-run setup downloads the
 * PopplerPDF plugin ZIP published with a release (built by build-popplerpdf-win / -mac +
 * dist-popplerpdf; see plugins/popplerpdf/README.md). Each ZIP is pinned here by URL and SHA-256.
 *
 * WHEN YOU REBUILD OR REPUBLISH THE ZIPs:
 *   1. Set POPPLER_PLUGIN_RELEASE to the GitHub release tag that hosts the ZIPs.
 *   2. Update the file name (version part) and `sha256` of every platform entry below.
 *      Hash a file with:  sha256sum <file>   (Linux)   |   shasum -a 256 <file>   (macOS)
 *   3. Windows on ARM reuses the x64 entry automatically; nothing to edit for it.
 * An entry with an empty `sha256` is treated as "not published yet" and is not offered.
 * A download whose hash differs is refused (lib/pluginDirector.js installPluginFromUrl).
 *
 * Exports: POPPLER_PLUGIN_RELEASE, POPPLER_PLUGIN_DOWNLOADS, getPopplerPluginDownload().
 * Callers: lib/popplerInstaller.js (download + install), lib/firstRunWizard.js (offers it or not).
 */

// ===================================== EDIT PER RELEASE =====================================

const POPPLER_PLUGIN_RELEASE = 'https://github.com/fiforms/revelation-electron-wrapper/releases/download/v1.0.12';

const POPPLER_PLUGIN_DOWNLOADS = {
  // process.platform-process.arch
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

// ============================================================================================

// Windows on ARM runs the x64 build under emulation.
POPPLER_PLUGIN_DOWNLOADS['win32-arm64'] = POPPLER_PLUGIN_DOWNLOADS['win32-x64'];

// The { url, sha256 } entry for this machine, or null when none is published for it.
function getPopplerPluginDownload(platform = process.platform, arch = process.arch) {
  const download = POPPLER_PLUGIN_DOWNLOADS[`${platform}-${arch}`];
  return download && download.sha256 ? download : null;
}

module.exports = { POPPLER_PLUGIN_RELEASE, POPPLER_PLUGIN_DOWNLOADS, getPopplerPluginDownload };
