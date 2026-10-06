// scripts/lib/wp-plugin.js: WordPress plugin version and zip name, shared by wp-package-plugin.js and prepackage.js.
// The version is the "Version:" header of WordPress/revelation-presentations/revelation-presentations.php (the one
// place to bump it, with readme.txt "Stable tag:"); the plugin derives RP_PLUGIN_VERSION from that header at runtime.
const fs = require('fs');
const path = require('path');

const bootstrapPath = path.join(__dirname, '..', '..', 'WordPress', 'revelation-presentations', 'revelation-presentations.php');

function readPluginVersion() {
  if (!fs.existsSync(bootstrapPath)) {
    throw new Error(`WordPress plugin bootstrap not found at ${bootstrapPath}`);
  }
  const match = fs.readFileSync(bootstrapPath, 'utf8').match(/^\s*\*\s*Version:\s*([^\r\n]+)$/m);
  const version = String(match?.[1] || '').trim();
  if (!version) {
    throw new Error(`Could not determine WordPress plugin version from the Version: header in ${bootstrapPath}`);
  }
  return version;
}

function buildZipFilename(version) {
  return `revelation-presentations-wordpress-plugin-${version}.zip`;
}

module.exports = { readPluginVersion, buildZipFilename };
