const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const revelationDir = path.join(rootDir, 'revelation');
const presentationsPrefix = 'presentations_';
const pluginsBibletextDir = path.join(rootDir, 'plugins.bibletext', 'bibles');
const ffprobeStaticBinDir = path.join(rootDir, 'node_modules', 'ffprobe-static', 'bin');

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

console.log('🧹 Cleaning packaging artifacts...');
removePresentationDirs();
removeBibleJsonFiles();
pruneFfprobeBinaries();
pruneNodeModulesDir(path.join(revelationDir, 'node_modules'), [
  'highlight.js']);

console.log('✅ Prepackage cleanup complete.');