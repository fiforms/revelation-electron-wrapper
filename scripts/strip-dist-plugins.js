const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const pluginsDir = path.join(rootDir, 'plugins');
const pluginsJsonPath = path.join(pluginsDir, 'plugins.json');

// Plugins that are not ready for distribution.
const STRIP_LIST = [
  'captions',
  'freeshow',
  'immich',
];

function stripDistPlugins() {
  console.log('🔌 Stripping non-distribution plugins...');

  for (const name of STRIP_LIST) {
    const pluginDir = path.join(pluginsDir, name);
    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true, force: true });
      console.log(`🗑️  Removed plugin directory: plugins/${name}`);
    }
  }

  if (!fs.existsSync(pluginsJsonPath)) {
    return;
  }

  const registry = JSON.parse(fs.readFileSync(pluginsJsonPath, 'utf8'));
  let changed = false;
  for (const name of STRIP_LIST) {
    if (Object.prototype.hasOwnProperty.call(registry, name)) {
      delete registry[name];
      console.log(`🗑️  Removed plugins.json entry: ${name}`);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(pluginsJsonPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  }

  console.log('✅ Non-distribution plugins stripped.');
}

module.exports = { stripDistPlugins };

if (require.main === module) {
  stripDistPlugins();
}
