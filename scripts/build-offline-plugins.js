// Runs the build() (or onBuild()) hook of every plugins/<name>/offline.js, in
// alphabetical order, passing { pluginName, pluginDir, rootDir, pluginsDir,
// revelationDir, log }. Part of `npm run build` (after copy-plugins.js) and also
// available as `npm run build:offline-plugins`. Sets a non-zero exit code if any hook fails.
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const pluginsDir = path.join(rootDir, 'plugins');
const revelationDir = path.join(rootDir, 'revelation');

function loadModuleFresh(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

async function run() {
  if (!fs.existsSync(pluginsDir)) {
    console.log(`ℹ️ Plugins directory not found: ${pluginsDir}`);
    return;
  }

  const pluginDirs = fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const offlineHooks = pluginDirs
    .map((pluginName) => ({
      pluginName,
      pluginDir: path.join(pluginsDir, pluginName),
      offlinePath: path.join(pluginsDir, pluginName, 'offline.js')
    }))
    .filter(({ offlinePath }) => fs.existsSync(offlinePath));

  if (!offlineHooks.length) {
    console.log('ℹ️ No plugin offline hooks found.');
    return;
  }

  let failed = false;

  for (const hookInfo of offlineHooks) {
    const { pluginName, pluginDir, offlinePath } = hookInfo;

    let hookModule;
    try {
      hookModule = loadModuleFresh(offlinePath);
    } catch (err) {
      failed = true;
      console.error(`❌ [offline-build/${pluginName}] Failed to load offline.js: ${err.message}`);
      continue;
    }

    const buildHook = typeof hookModule?.build === 'function'
      ? hookModule.build
      : typeof hookModule?.onBuild === 'function'
      ? hookModule.onBuild
      : null;

    if (!buildHook) {
      console.log(`ℹ️ [offline-build/${pluginName}] offline.js found, no build() hook.`);
      continue;
    }

    console.log(`🧩 [offline-build/${pluginName}] Running build hook...`);

    try {
      await buildHook({
        pluginName,
        pluginDir,
        rootDir,
        pluginsDir,
        revelationDir,
        log: (...args) => console.log(`[offline-build/${pluginName}]`, ...args)
      });
      console.log(`✅ [offline-build/${pluginName}] Build hook complete.`);
    } catch (err) {
      failed = true;
      console.error(`❌ [offline-build/${pluginName}] build() failed: ${err.message}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('❌ build-offline-plugins failed:', err);
  process.exit(1);
});
