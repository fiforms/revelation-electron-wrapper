const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const archiver = require('archiver');
const { stripDistPlugins } = require('./strip-dist-plugins');
const { stashMove, stashCopy, restoreAll, hasPendingStash } = require('./package-stash');

const rootDir = path.resolve(__dirname, '..');
const revelationDir = path.join(rootDir, 'revelation');
const distDir = path.join(rootDir, 'dist');
const presentationsPrefix = 'presentations_';
const pluginsBibletextDir = path.join(rootDir, 'plugins', 'bibletext', 'bibles');
const popplerPluginDir = path.join(rootDir, 'plugins', 'popplerpdf');
const popplerPluginZipPath = path.join(rootDir, 'dist', 'popplerpdf.zip');
const wordpressBuildDir = path.join(rootDir, 'WordPress', 'build');
const wordpressPluginBootstrapPath = path.join(rootDir, 'WordPress', 'revelation-presentations', 'revelation-presentations.php');

function readWordPressPluginVersion() {
  if (!fs.existsSync(wordpressPluginBootstrapPath)) {
    throw new Error(`WordPress plugin bootstrap not found at ${wordpressPluginBootstrapPath}`);
  }
  const source = fs.readFileSync(wordpressPluginBootstrapPath, 'utf8');
  const defineMatch = source.match(/define\(\s*['"]RP_PLUGIN_VERSION['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
  const headerMatch = source.match(/^\s*\*\s*Version:\s*([^\r\n]+)$/m);
  const match = defineMatch || headerMatch;
  if (!match) {
    throw new Error(`Could not determine WordPress plugin version from ${wordpressPluginBootstrapPath}`);
  }
  const version = String(match[1] || '').trim();
  if (!version) {
    throw new Error(`WordPress plugin version is empty in ${wordpressPluginBootstrapPath}`);
  }
  return version;
}

function buildWordPressPluginZipFilename(version) {
  return `revelation-presentations-wordpress-plugin-${version}.zip`;
}

// Pruned items go to the package stash instead of being deleted; package.js restores them.
function stashPath(targetPath) {
  stashMove(targetPath);
}

function safeRemove(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyWordPressPluginZip() {
  const version = readWordPressPluginVersion();
  const zipFilename = buildWordPressPluginZipFilename(version);
  const wordpressPluginZipSourcePath = path.join(wordpressBuildDir, zipFilename);
  const wordpressPluginZipDistPath = path.join(distDir, zipFilename);

  if (!fs.existsSync(wordpressPluginZipSourcePath)) {
    throw new Error(`WordPress plugin archive not found at ${wordpressPluginZipSourcePath}`);
  }

  fs.mkdirSync(distDir, { recursive: true });
  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/^revelation-presentations-wordpress-plugin-[^/\\]+\.zip$/i.test(entry.name)) continue;
    safeRemove(path.join(distDir, entry.name));
  }
  fs.copyFileSync(wordpressPluginZipSourcePath, wordpressPluginZipDistPath);
  console.log(`📦 Copied WordPress plugin archive to ${wordpressPluginZipDistPath}`);
}

function removePresentationDirs() {
  if (!fs.existsSync(revelationDir)) {
    return;
  }
  const entries = fs.readdirSync(revelationDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (!entry.name.startsWith(presentationsPrefix)) {
      continue;
    }
    stashPath(path.join(revelationDir, entry.name));
  }
}

function removeBibleJsonFiles() {
  if (!fs.existsSync(pluginsBibletextDir)) {
    return;
  }
  const entries = fs.readdirSync(pluginsBibletextDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    stashPath(path.join(pluginsBibletextDir, entry.name));
  }
}

// Entries in removeList match by exact name; a trailing '*' matches by prefix
// (used for per-platform native packages such as lightningcss-win32-x64-msvc).
function matchesRemoveList(name, removeList) {
  return removeList.some((pattern) =>
    pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern);
}

function pruneNodeModulesDir(targetDir, removeList) {
  if (!fs.existsSync(targetDir)) {
    console.warn(`⚠️  Directory not found: ${targetDir}; skipping pruning.`);
    return;
  }
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    if (matchesRemoveList(entry.name, removeList)) {
      stashPath(path.join(targetDir, entry.name));
    }
  }
}

function pruneDanglingBinLinks(nodeModulesDir) {
  const binDir = path.join(nodeModulesDir, '.bin');
  if (!fs.existsSync(binDir)) {
    return;
  }

  for (const entry of fs.readdirSync(binDir)) {
    const entryPath = path.join(binDir, entry);
    let stats;
    try {
      stats = fs.lstatSync(entryPath);
    } catch {
      continue;
    }

    if (!stats.isSymbolicLink()) {
      continue;
    }

    let linkTarget;
    try {
      linkTarget = fs.readlinkSync(entryPath);
    } catch {
      continue;
    }

    const resolvedTarget = path.resolve(path.dirname(entryPath), linkTarget);
    if (!fs.existsSync(resolvedTarget)) {
      safeRemove(entryPath);
    }
  }
}


function pruneRevelationDevDependencies() {
  const nodeModulesDir = path.join(revelationDir, 'node_modules');
  if (!fs.existsSync(nodeModulesDir)) {
    console.warn('⚠️  revelation/node_modules not found; skipping npm prune.');
    return;
  }
  // prune modifies node_modules in place, so keep a full copy to swap back afterwards.
  console.log('💾 Copying revelation/node_modules to the package stash...');
  stashCopy(nodeModulesDir);
  console.log('🌿 Running npm prune --production in revelation/...');
  const result = spawnSync('npm', ['prune', '--production'], {
    cwd: revelationDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`npm prune --production failed (exit code ${result.status})`);
  }
}

function zipDirectory(sourceDir, outputZipPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outputZipPath), { recursive: true });
    const output = fs.createWriteStream(outputZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(archive.pointer()));
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

function hasPopplerPayload(pluginDir) {
  if (!fs.existsSync(pluginDir)) {
    return false;
  }
  const entries = fs.readdirSync(pluginDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('poppler-')) {
      continue;
    }
    const payloadProbe = path.join(pluginDir, entry.name, 'Library', 'bin', 'pdfimages.exe');
    if (fs.existsSync(payloadProbe)) {
      return true;
    }
  }
  return false;
}

async function packagePopplerPlugin() {
  if (hasPopplerPayload(popplerPluginDir)) {
    await zipDirectory(popplerPluginDir, popplerPluginZipPath);
    console.log(`📦 Poppler plugin archive created: ${popplerPluginZipPath}`);
  }

  stashPath(popplerPluginDir);
  console.log(`🗑️  Stashed plugin directory: ${popplerPluginDir}`);
}

async function run() {
  if (hasPendingStash()) {
    console.log('♻️  Restoring items left over from an interrupted package run...');
    restoreAll();
  }
  console.log('🧹 Cleaning packaging artifacts...');
  stripDistPlugins();
  copyWordPressPluginZip();
  removePresentationDirs();
  removeBibleJsonFiles();
  pruneRevelationDevDependencies();
  pruneNodeModulesDir(path.join(revelationDir, 'node_modules'), [
    '@parcel',
    '@types',
    'chart.js',
    'es-abstract',
    'highlight.js',
    // Vite dev server (the only way the app runs it) needs neither; rolldown does the bundling.
    '@esbuild',
    'esbuild',
    'lightningcss*',
    'npm',
    'node-addon-api',
    'sass',
    'reveal.js-plugins'
  ]);
  pruneDanglingBinLinks(path.join(revelationDir, 'node_modules'));
  await packagePopplerPlugin();

  console.log('✅ Prepackage cleanup complete.');
}

module.exports = { run };

if (require.main === module) {
  run().catch((err) => {
    console.error('❌ Prepackage failed:', err.message);
    console.error('   Run `node scripts/package-stash.js` to restore pruned files.');
    process.exit(1);
  });
}
