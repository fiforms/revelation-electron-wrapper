// Shared by prepackage.js and dist-popplerpdf.js: find the Poppler payload that
// build-popplerpdf-win.js / build-popplerpdf-mac.js put into plugins/popplerpdf
// and name the plugin ZIP after its platform and architecture, e.g.
//   PopplerPDF.Plugin.26.09.for.REVELation.Windows-x64.zip
//   PopplerPDF.Plugin.26.09.for.REVELation.macOS-arm64.zip
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const popplerPluginDir = path.join(rootDir, 'plugins', 'popplerpdf');

// Returns { folder, platform, arch } for the payload in the plugin folder, or null.
function detectPopplerPayload(pluginDir = popplerPluginDir) {
  if (!fs.existsSync(pluginDir)) return null;
  const entries = fs.readdirSync(pluginDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('poppler-'));
  for (const entry of entries) {
    const dir = path.join(pluginDir, entry.name);
    if (fs.existsSync(path.join(dir, 'Library', 'bin', 'pdfimages.exe'))) {
      return { folder: entry.name, platform: 'Windows', arch: 'x64' };
    }
    const macMatch = entry.name.match(/-macos-(arm64|x64)$/);
    if (macMatch && fs.existsSync(path.join(dir, 'bin', 'pdftoppm'))) {
      return { folder: entry.name, platform: 'macOS', arch: macMatch[1] };
    }
  }
  return null;
}

function popplerPluginZipName(payload, pluginDir = popplerPluginDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin-manifest.json'), 'utf8'));
  const shortVersion = String(manifest.plugin_version || '').split('.').slice(0, 2).join('.');
  return `PopplerPDF.Plugin.${shortVersion}.for.REVELation.${payload.platform}-${payload.arch}.zip`;
}

module.exports = { popplerPluginDir, detectPopplerPayload, popplerPluginZipName };
