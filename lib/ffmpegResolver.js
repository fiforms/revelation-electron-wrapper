// ffmpeg binary resolution. Exports: resolveFfmpegBinary(AppContext), getActiveFfmpegPath(AppContext),
// getFfmpegVersionInfo(), configureFfmpegForModule(ffmpegModule, AppContext).
// Callers: main.js (once at startup; result stored in AppContext.ffmpegPath) and aboutWindow.js (version text).
// config.ffmpegPath is ONLY the user's setting and is persisted; the auto-detected path lives in
// AppContext.ffmpegPath (runtime, never saved) so a stale packaged/temp path cannot later pass for a user choice.
// Consumers (importPresentation.js, mediaLibrary.js, serverManager.js, plugins/compactor, plugins/mediafx) read
// getActiveFfmpegPath() / AppContext.ffmpegPath. configureFfmpegForModule is unused.
// libreofficeResolver.js repeats the same "configured -> known locations -> PATH" pattern.

const path = require('path');
const fs = require('fs');
const which = require('which');

/**
 * Resolves the ffmpeg binary path with a three-level fallback chain:
 * 1. User-configured path (AppContext.config.ffmpegPath)
 * 2. Packaged binary location (process.resourcesPath/bin/ffmpeg/)
 * 3. System PATH
 */
async function resolveFfmpegBinary(AppContext) {
  if (AppContext?.config?.ffmpegPath && fs.existsSync(AppContext.config.ffmpegPath)) {
    return AppContext.config.ffmpegPath;
  }

  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const packagedPath = path.join(process.resourcesPath, 'bin', 'ffmpeg', binaryName);
  if (fs.existsSync(packagedPath)) {
    return packagedPath;
  }

  try {
    return await which(binaryName);
  } catch (err) {
    return null;
  }
}


/**
 * The ffmpeg path to run: the one detected at startup, else the user's setting, else null.
 */
function getActiveFfmpegPath(AppContext) {
  return AppContext?.ffmpegPath || AppContext?.config?.ffmpegPath || null;
}

/**
 * Reads the bundled versions.txt for the ffmpeg binary.
 * Looks in resourcesPath/bin/ffmpeg/ (packaged) then bin/ffmpeg/ (dev).
 * Returns the trimmed text content, or null if not found.
 */
function getFfmpegVersionInfo() {
  const candidates = [
    path.join(process.resourcesPath, 'bin', 'ffmpeg', 'versions.txt'),
    path.join(__dirname, '..', 'bin', 'ffmpeg', 'versions.txt'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        return fs.readFileSync(candidate, 'utf8').trim();
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Helper to configure a fluent-ffmpeg module instance with the resolved binary path.
 * Silently succeeds if ffmpeg is not found (fluent-ffmpeg will use system PATH).
 */
async function configureFfmpegForModule(ffmpegModule, AppContext) {
  const ffmpegPath = await resolveFfmpegBinary(AppContext);
  if (ffmpegPath) {
    ffmpegModule.setFfmpegPath(ffmpegPath);
  }
}

module.exports = {
  resolveFfmpegBinary,
  getActiveFfmpegPath,
  getFfmpegVersionInfo,
  configureFfmpegForModule,
};
