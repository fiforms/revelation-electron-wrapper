const path = require('path');
const fs = require('fs');
const which = require('which');

/**
 * Resolves the ffmpeg binary path with a three-level fallback chain:
 * 1. User-configured path (AppContext.config.ffmpegPath)
 * 2. Packaged binary location (process.resourcesPath/ffmpeg/)
 * 3. System PATH
 */
async function resolveFfmpegBinary(AppContext) {
  if (AppContext?.config?.ffmpegPath) {
    return AppContext.config.ffmpegPath;
  }

  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const packagedPath = path.join(process.resourcesPath, 'ffmpeg', binaryName);
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
 * Reads the bundled versions.txt for the ffmpeg binary.
 * Looks in resourcesPath/ffmpeg/ (packaged) then bin/ffmpeg/ (dev).
 * Returns the trimmed text content, or null if not found.
 */
function getFfmpegVersionInfo() {
  const candidates = [
    path.join(process.resourcesPath, 'ffmpeg', 'versions.txt'),
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
  getFfmpegVersionInfo,
  configureFfmpegForModule,
};
