const fs = require('fs');
const path = require('path');
const which = require('which');

// A macOS app opened from Finder or the Dock gets a minimal PATH without
// Homebrew's folders, so `brew install poppler` would not be found through PATH.
const MAC_HOMEBREW_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

/**
 * Resolves the poppler binary paths (pdftoppm and pdfinfo) with a fallback chain:
 * 1. User-configured path (plugin config)
 * 2. System PATH via which()
 * 3. On macOS, the Homebrew bin folders
 *
 * @param {string} toolName - 'pdftoppm' or 'pdfinfo'
 * @param {string} configuredPath - User-configured path from plugin config
 * @returns {Promise<string>} Path to binary or falls back to tool name for system PATH lookup
 */
async function resolvePopplerBinary(toolName, configuredPath = '') {
  // Use user-configured path if provided
  if (configuredPath && configuredPath.trim()) {
    return configuredPath.trim();
  }

  const binaryName = process.platform === 'win32' ? `${toolName}.exe` : toolName;

  // Try to find in system PATH
  try {
    return await which(binaryName);
  } catch (err) {
    if (process.platform === 'darwin') {
      for (const dir of MAC_HOMEBREW_BIN_DIRS) {
        const candidate = path.join(dir, binaryName);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    // If not found, return the tool name and let the caller handle the error
    // This maintains compatibility with existing behavior where the command
    // is attempted and error handling occurs later
    return toolName;
  }
}

/**
 * Resolves both pdftoppm and pdfinfo paths
 *
 * @param {Object} config - Plugin config object with pdftoppmPath and pdfinfoPath
 * @returns {Promise<Object>} Object with resolved paths: { pdftoppmPath, pdfinfoPath }
 */
async function resolvePopplerTools(config = {}) {
  const [pdftoppmPath, pdfinfoPath] = await Promise.all([
    resolvePopplerBinary('pdftoppm', config.pdftoppmPath),
    resolvePopplerBinary('pdfinfo', config.pdfinfoPath)
  ]);

  return { pdftoppmPath, pdfinfoPath };
}

module.exports = {
  resolvePopplerBinary,
  resolvePopplerTools,
};
