// Zips WordPress/revelation-presentations/ (excluding its scripts/ dir and .DS_Store)
// into WordPress/build/revelation-presentations-wordpress-plugin-<version>.zip,
// with a top-level revelation-presentations/ folder. <version> is read from
// the header Version: in revelation-presentations.php (see scripts/lib/wp-plugin.js; keep readme.txt
// "Stable tag:" in step). Older plugin zips in WordPress/build/ are deleted first.
// prepackage.js later copies the zip into dist/ for release.
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { readPluginVersion, buildZipFilename } = require('./lib/wp-plugin');

const rootDir = path.resolve(__dirname, '..');
const pluginRoot = path.join(rootDir, 'WordPress', 'revelation-presentations');
const buildDir = path.join(rootDir, 'WordPress', 'build');

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

    const version = readPluginVersion();
    const zipFilename = buildZipFilename(version);
    const zipPath = path.join(buildDir, zipFilename);

    fs.mkdirSync(buildDir, { recursive: true });
    for (const entry of fs.readdirSync(buildDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/^revelation-presentations(?:-wordpress-plugin-[^/\\]+)?\.zip$/i.test(entry.name)) continue;
      fs.rmSync(path.join(buildDir, entry.name), { force: true });
    }

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve({ zipPath, version }));
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    addDirectoryToArchive(archive, pluginRoot, 'revelation-presentations');
    archive.finalize();
  });
}

buildPluginZip()
  .then(({ zipPath, version }) => {
    console.log(`Built WordPress plugin ${version}: ${zipPath}`);
  })
  .catch((err) => {
    console.error(`❌ wp-package-plugin failed: ${err.message}`);
    process.exit(1);
  });
