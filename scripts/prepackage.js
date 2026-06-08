const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { stripDistPlugins } = require('./strip-dist-plugins');

const rootDir = path.resolve(__dirname, '..');
const revelationDir = path.join(rootDir, 'revelation');
const distDir = path.join(rootDir, 'dist');
const presentationsPrefix = 'presentations_';
const pluginsBibletextDir = path.join(rootDir, 'plugins.bibletext', 'bibles');
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
    safeRemove(path.join(revelationDir, entry.name));
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
    safeRemove(path.join(pluginsBibletextDir, entry.name));
  }
}

function pruneNodeModulesDir(targetDir, removeList) {
  if (!fs.existsSync(targetDir)) {
    console.warn(`⚠️  Directory not found: ${targetDir}; skipping pruning.`);
    return;
  }
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    if (removeList.includes(entry.name)) {
      safeRemove(path.join(targetDir, entry.name));
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

  safeRemove(popplerPluginDir);
  console.log(`🗑️  Removed plugin directory: ${popplerPluginDir}`);
}

async function run() {
  console.log('🧹 Cleaning packaging artifacts...');
  stripDistPlugins();
  copyWordPressPluginZip();
  removePresentationDirs();
  removeBibleJsonFiles();
  pruneNodeModulesDir(path.join(revelationDir, 'node_modules'), [
    '@parcel',
    '@types',
    'chart.js',
    'es-abstract',
    'highlight.js',
    'npm',
    'npm-run-all',
    'node-addon-api',
    'sass',
    'reveal.js-plugins'
  ]);
  pruneDanglingBinLinks(path.join(revelationDir, 'node_modules'));
  await packagePopplerPlugin();

  console.log('✅ Prepackage cleanup complete.');
}

run().catch((err) => {
  console.error('❌ Prepackage failed:', err.message);
  process.exit(1);
});
