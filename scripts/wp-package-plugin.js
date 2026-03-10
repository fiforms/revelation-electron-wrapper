const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const rootDir = path.resolve(__dirname, '..');
const pluginRoot = path.join(rootDir, 'WordPress', 'revelation-presentations');
const buildDir = path.join(rootDir, 'WordPress', 'build');
const zipPath = path.join(buildDir, 'revelation-presentations.zip');

function shouldSkipEntry(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  return normalized === '.DS_Store'
    || normalized.endsWith('/.DS_Store')
    || normalized === 'scripts'
    || normalized.startsWith('scripts/');
}

function addDirectoryToArchive(archive, sourceDir, archivePrefix, relativeDir = '') {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    if (shouldSkipEntry(relativePath)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const archivePath = path.posix.join(archivePrefix, relativePath.split(path.sep).join('/'));

    if (entry.isDirectory()) {
      addDirectoryToArchive(archive, sourcePath, archivePrefix, relativePath);
      continue;
    }

    archive.file(sourcePath, { name: archivePath });
  }
}

function buildPluginZip() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(pluginRoot)) {
      reject(new Error(`Plugin directory not found: ${pluginRoot}`));
      return;
    }

    fs.mkdirSync(buildDir, { recursive: true });
    fs.rmSync(zipPath, { force: true });

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    addDirectoryToArchive(archive, pluginRoot, 'revelation-presentations');
    archive.finalize();
  });
}

buildPluginZip()
  .then(() => {
    console.log(`Built: ${zipPath}`);
  })
  .catch((err) => {
    console.error(`❌ wp-package-plugin failed: ${err.message}`);
    process.exit(1);
  });
