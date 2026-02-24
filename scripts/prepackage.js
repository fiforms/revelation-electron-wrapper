const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const rootDir = path.resolve(__dirname, '..');
const revelationDir = path.join(rootDir, 'revelation');
const presentationsPrefix = 'presentations_';
const pluginsBibletextDir = path.join(rootDir, 'plugins.bibletext', 'bibles');
const ffprobeStaticBinDir = path.join(rootDir, 'node_modules', 'ffprobe-static', 'bin');
const popplerPluginDir = path.join(rootDir, 'plugins', 'popplerpdf');
const popplerPluginZipPath = path.join(rootDir, 'dist', 'popplerpdf.zip');

function safeRemove(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
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

function pruneFfprobeBinaries() {
  if (!fs.existsSync(ffprobeStaticBinDir)) {
    console.warn('⚠️  ffprobe-static not found; skipping ffprobe binary pruning.');
    return;
  }

  const platform = process.platform;
  const arch = process.arch;
  const ffprobeName = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const targetDir = path.join(ffprobeStaticBinDir, platform, arch);
  const targetBinary = path.join(targetDir, ffprobeName);

  if (!fs.existsSync(targetBinary)) {
    console.warn(`⚠️  ffprobe binary not found at ${targetBinary}; skipping pruning.`);
    return;
  }

  for (const entry of fs.readdirSync(ffprobeStaticBinDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name !== platform) {
      safeRemove(path.join(ffprobeStaticBinDir, entry.name));
    }
  }

  if (fs.existsSync(path.join(ffprobeStaticBinDir, platform))) {
    const archEntries = fs.readdirSync(path.join(ffprobeStaticBinDir, platform), { withFileTypes: true });
    for (const entry of archEntries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name !== arch) {
        safeRemove(path.join(ffprobeStaticBinDir, platform, entry.name));
      }
    }
  }

  console.log(`✅ Kept ffprobe binary for ${platform}/${arch}.`);
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
  if (!hasPopplerPayload(popplerPluginDir)) {
    return;
  }

  await zipDirectory(popplerPluginDir, popplerPluginZipPath);
  console.log(`📦 Poppler plugin archive created: ${popplerPluginZipPath}`);


  safeRemove(popplerPluginDir);
}

async function run() {
  console.log('🧹 Cleaning packaging artifacts...');
  removePresentationDirs();
  removeBibleJsonFiles();
  pruneFfprobeBinaries();
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
