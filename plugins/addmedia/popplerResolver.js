const which = require('which');

/**
 * Resolves the poppler binary paths (pdftoppm and pdfinfo) with a fallback chain:
 * 1. User-configured path (plugin config)
 * 2. System PATH via which()
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
