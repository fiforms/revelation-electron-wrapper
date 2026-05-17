const path = require('path');
const fs = require('fs');
const which = require('which');

/**
 * Resolves the ffmpeg binary path with a three-level fallback chain:
 * 1. User-configured path (AppContext.config.ffmpegPath)
 * 2. Packaged binary location (process.resourcesPath/ffmpeg)
 * 3. System PATH
 *
 * @param {Object} AppContext - Application context with config
 * @returns {Promise<string|null>} Path to ffmpeg binary or null if not found
 */
async function resolveFfmpegBinary(AppContext) {
  // Check user-configured path
  if (AppContext?.config?.ffmpegPath) {
    return AppContext.config.ffmpegPath;
  }

  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

  // Check packaged binary location (set up by electron-builder from ffmpeg-static)
  const packagedPath = path.join(
    process.resourcesPath,
    'ffmpeg',
    binaryName
  );
  if (fs.existsSync(packagedPath)) {
    return packagedPath;
  }

  // Fall back to system PATH
  try {
    return await which(binaryName);
  } catch (err) {
    return null;
  }
}

/**
 * Helper to configure a fluent-ffmpeg module instance with the resolved binary path.
 * Silently succeeds if ffmpeg is not found (fluent-ffmpeg will use system PATH).
 *
 * @param {Object} ffmpegModule - fluent-ffmpeg module instance
 * @param {Object} AppContext - Application context with config
 */
async function configureFfmpegForModule(ffmpegModule, AppContext) {
  const ffmpegPath = await resolveFfmpegBinary(AppContext);
  if (ffmpegPath) {
    ffmpegModule.setFfmpegPath(ffmpegPath);
  }
}

module.exports = {
  resolveFfmpegBinary,
  configureFfmpegForModule,
};
