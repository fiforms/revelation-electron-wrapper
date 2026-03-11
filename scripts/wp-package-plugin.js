const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const rootDir = path.resolve(__dirname, '..');
const pluginRoot = path.join(rootDir, 'WordPress', 'revelation-presentations');
const pluginBootstrapPath = path.join(pluginRoot, 'revelation-presentations.php');
const buildDir = path.join(rootDir, 'WordPress', 'build');

function readPluginVersion() {
  if (!fs.existsSync(pluginBootstrapPath)) {
    throw new Error(`Plugin bootstrap not found: ${pluginBootstrapPath}`);
  }
  const source = fs.readFileSync(pluginBootstrapPath, 'utf8');
  const defineMatch = source.match(/define\(\s*['"]RP_PLUGIN_VERSION['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
  const headerMatch = source.match(/^\s*\*\s*Version:\s*([^\r\n]+)$/m);
  const match = defineMatch || headerMatch;
  if (!match) {
    throw new Error(`Could not determine WordPress plugin version from ${pluginBootstrapPath}`);
  }
  const version = String(match[1] || '').trim();
  if (!version) {
    throw new Error(`WordPress plugin version is empty in ${pluginBootstrapPath}`);
  }
  return version;
}

function buildZipFilename(version) {
  return `revelation-presentations-wordpress-plugin-${version}.zip`;
}

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
