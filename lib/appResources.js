/**
 * appResources.js -- startup-time resource setup that must run before the other lib/ modules load.
 *
 * ensureWritableResources(): packaged builds only matter here (process.resourcesPath). Copies/re-syncs the
 *   bundled revelation and plugins into <userData>/resources when the install dir is read-only (typical on
 *   Linux /opt) or a mirror already exists. configManager.defaultRevelationDir prefers that mirror when it
 *   exists. User-installed plugins survive: only entries recorded in .sync-state.json as bundled are pruned.
 * ensureAppNodeModulesOnPath(): adds the app's node_modules to NODE_PATH so plugins can require() its packages.
 *
 * Exports: ensureWritableResources, ensureAppNodeModulesOnPath. Caller: main.js, right after the
 * single-instance lock and before any lib/ module is required. Uses console.* (silenced unless --enable-debug)
 * because AppContext does not exist yet.
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsExtra = require('fs-extra');
const Module = require('module');

function ensureWritableResources() {
  const userDataDir = app.getPath('userData');
  const userResources = path.join(userDataDir, 'resources');
  const userRevelation = path.join(userResources, 'revelation');
  const userPlugins = path.join(userResources, 'plugins');
  const appRevelation = path.join(process.resourcesPath, 'revelation');
  const appPlugins = path.join(process.resourcesPath, 'plugins');
  const appPkg = path.join(appRevelation, 'package.json');
  const userPkg = path.join(userRevelation, 'package.json');
  const syncStatePath = path.join(userResources, '.sync-state.json');

  // If system folder is not writable (typical on Linux /opt)
  let writable = true;
  try {
    fs.accessSync(process.resourcesPath, fs.constants.W_OK);
    console.log(`System resources path is writable: ${process.resourcesPath}`);
  } catch {
    writable = false;
  }

  const hasUserMirror = fs.existsSync(userRevelation) || fs.existsSync(userPlugins);
  const shouldUseUserResources = !writable || hasUserMirror;
  if (!shouldUseUserResources) return;

  if (!writable) {
    console.log(`System resources path is not writable: ${process.resourcesPath}`);
  } else {
    console.log(`System resources path is writable, but existing user resource mirror found.`);
  }
  console.log(`Using user resources path: ${userResources}`);
  fs.mkdirSync(userResources, { recursive: true });

  try {
    if (!fs.existsSync(userRevelation) && fs.existsSync(appRevelation)) {
      fsExtra.copySync(appRevelation, userRevelation, { overwrite: false });
      console.log('📦 Copied revelation to user resources folder.');
    }
    if (!fs.existsSync(userPlugins) && fs.existsSync(appPlugins)) {
      fsExtra.copySync(appPlugins, userPlugins, { overwrite: false });
      console.log('📦 Copied plugins to user resources folder.');
    }

    if (!fs.existsSync(appPkg)) return;

    const syncState = readJsonSafe(syncStatePath) || {};
    const appVer = String((readJsonSafe(appPkg) || {}).version || '').trim();
    if (!appVer) return;

    let userVer = '0.0.0';
    const userPkgJson = readJsonSafe(userPkg);
    if (userPkgJson && typeof userPkgJson.version === 'string' && userPkgJson.version.trim()) {
      userVer = userPkgJson.version.trim();
    } else if (typeof syncState.revelationVersion === 'string' && syncState.revelationVersion.trim()) {
      userVer = syncState.revelationVersion.trim();
    }

    const runtimeProbeFiles = [
      path.join(userRevelation, 'package.json'),
      path.join(userRevelation, 'node_modules', 'vite', 'bin', 'vite.js'),
      path.join(userRevelation, 'node_modules', 'reveal.js-remote', 'server', 'index.js')
    ];
    const missingRuntimeFiles = runtimeProbeFiles.filter((probePath) => !fs.existsSync(probePath));
    const needsRuntimeRepair = missingRuntimeFiles.length > 0;

    if (appVer !== userVer || needsRuntimeRepair) {
      if (needsRuntimeRepair) {
        console.log(`🔧 Missing runtime files in user mirror; syncing updates...`);
      } else {
        console.log(`🔄 Revelation version changed (${userVer} → ${appVer}), syncing updates...`);
      }
      replaceDirectory(appRevelation, userRevelation);
      const bundledEntries = syncBundledPlugins(
        appPlugins,
        userPlugins,
        Array.isArray(syncState.bundledPluginEntries) ? syncState.bundledPluginEntries : []
      );
      writeSyncState(syncStatePath, {
        revelationVersion: appVer,
        bundledPluginEntries: bundledEntries,
        syncedAt: new Date().toISOString()
      });
      console.log('✅ User resources updated.');
      return;
    }

    // Keep sync metadata populated for recovery and future stale-plugin pruning.
    const currentBundledEntries = listEntryNames(appPlugins);
    if (
      !Array.isArray(syncState.bundledPluginEntries) ||
      syncState.revelationVersion !== appVer
    ) {
      writeSyncState(syncStatePath, {
        revelationVersion: appVer,
        bundledPluginEntries: currentBundledEntries,
        syncedAt: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error(`❌ Failed to sync user resources: ${err.message}`);
    console.error('Continuing startup with available resources.');
  }
}

function ensureAppNodeModulesOnPath() {
  const appNodeModules = path.join(app.getAppPath(), 'node_modules');
  if (!fs.existsSync(appNodeModules)) return;

  const existing = process.env.NODE_PATH
    ? process.env.NODE_PATH.split(path.delimiter).filter(Boolean)
    : [];
  if (existing.includes(appNodeModules)) return;

  process.env.NODE_PATH = [...existing, appNodeModules].join(path.delimiter);
  Module._initPaths();
  console.log(`Added app node_modules to NODE_PATH: ${appNodeModules}`);
}

function syncBundledPlugins(appPlugins, userPlugins, previousBundledEntries = []) {
  if (!fs.existsSync(appPlugins)) return [];
  fs.mkdirSync(userPlugins, { recursive: true });

  const bundledEntryNames = listEntryNames(appPlugins);
  const previouslyBundled = new Set(previousBundledEntries);
  const currentlyBundled = new Set(bundledEntryNames);

  // Remove entries that used to be bundled but are no longer bundled now.
  for (const name of previouslyBundled) {
    if (currentlyBundled.has(name)) continue;
    const stalePath = path.join(userPlugins, name);
    if (fs.existsSync(stalePath)) {
      fs.rmSync(stalePath, { recursive: true, force: true });
    }
  }

  // Replace every currently bundled plugin entry while preserving user-only entries.
  for (const name of bundledEntryNames) {
    const srcPath = path.join(appPlugins, name);
    const destPath = path.join(userPlugins, name);

    if (fs.existsSync(destPath)) {
      fs.rmSync(destPath, { recursive: true, force: true });
    }
    fsExtra.copySync(srcPath, destPath, { overwrite: true, errorOnExist: false });
  }

  return bundledEntryNames;
}

function replaceDirectory(sourcePath, destPath) {
  if (!fs.existsSync(sourcePath)) return;
  const tmpPath = `${destPath}.tmp-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (fs.existsSync(tmpPath)) {
    fs.rmSync(tmpPath, { recursive: true, force: true });
  }
  fsExtra.copySync(sourcePath, tmpPath, { overwrite: true, errorOnExist: false });
  if (fs.existsSync(destPath)) {
    fs.rmSync(destPath, { recursive: true, force: true });
  }
  fs.renameSync(tmpPath, destPath);
}

function listEntryNames(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => entry.name);
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeSyncState(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { ensureWritableResources, ensureAppNodeModulesOnPath };
