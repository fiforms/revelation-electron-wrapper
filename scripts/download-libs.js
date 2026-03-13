#!/usr/bin/env node

// Download and bundle PHP libraries for the WordPress plugin
// Cross-platform Node.js script using unzipper

const https = require('https');
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');

const PLUGIN_DIR = path.join(__dirname, '..', 'WordPress', 'revelation-presentations');
const VENDOR_DIR = path.join(PLUGIN_DIR, 'vendor');

function mkdirp(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        download(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
      file.on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    });
    request.on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

function extract(zipPath, extractTo) {
  return unzipper.Open.file(zipPath).then(directory => {
    // Find the top-level directory prefix to strip
    const firstFile = directory.files.find(file => !file.path.endsWith('/'));
    if (!firstFile) return Promise.resolve();
    const prefix = firstFile.path.split('/')[0] + '/';
    
    const promises = [];
    directory.files.forEach(file => {
      if (file.path.endsWith('/')) return; // skip directories
      // Strip the prefix
      const relativePath = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path;
      if (!relativePath) return; // skip the top-level dir itself
      const filePath = path.join(extractTo, relativePath);
      mkdirp(path.dirname(filePath));
      promises.push(new Promise((resolve, reject) => {
        file.stream()
          .pipe(fs.createWriteStream(filePath))
          .on('finish', resolve)
          .on('error', reject);
      }));
    });
    return Promise.all(promises);
  }).then(() => {
    fs.unlinkSync(zipPath); // remove zip after extraction
  }).catch(error => {
    console.warn(`Warning: Failed to extract ${zipPath}:`, error.message);
  });
}

async function downloadAndExtract(label, url, zipName, extractTo) {
  console.log(`Downloading ${label}...`);
  const zipPath = path.join(PLUGIN_DIR, zipName);
  await download(url, zipPath);
  await extract(zipPath, extractTo);
}

async function main() {
  // CommonMark 2.4 pulls in additional runtime dependencies beyond its own src/.
  // Keep this bundled set aligned with the versions declared by our pinned packages.
  const commonmarkDir = path.join(VENDOR_DIR, 'league', 'commonmark', 'src');
  const parsedownFile = path.join(VENDOR_DIR, 'erusev', 'parsedown', 'Parsedown.php');
  const configDir = path.join(VENDOR_DIR, 'league', 'config', 'src');
  const psrDir = path.join(VENDOR_DIR, 'psr', 'event-dispatcher', 'src');
  const symfonyDeprecationDir = path.join(VENDOR_DIR, 'symfony', 'deprecation-contracts');
  const symfonyPolyfillDir = path.join(VENDOR_DIR, 'symfony', 'polyfill-php80');
  const dotAccessDir = path.join(VENDOR_DIR, 'dflydev', 'dot-access-data', 'src');
  const netteSchemaDir = path.join(VENDOR_DIR, 'nette', 'schema', 'src');
  const netteUtilsDir = path.join(VENDOR_DIR, 'nette', 'utils', 'src');

  if (
    fs.existsSync(commonmarkDir) &&
    fs.existsSync(parsedownFile) &&
    fs.existsSync(configDir) &&
    fs.existsSync(psrDir) &&
    fs.existsSync(symfonyDeprecationDir) &&
    fs.existsSync(symfonyPolyfillDir) &&
    fs.existsSync(dotAccessDir) &&
    fs.existsSync(netteSchemaDir) &&
    fs.existsSync(netteUtilsDir)
  ) {
    console.log('Libraries already bundled, skipping download.');
    return;
  }

  mkdirp(path.join(VENDOR_DIR, 'league', 'commonmark', 'src'));
  mkdirp(path.join(VENDOR_DIR, 'erusev', 'parsedown'));
  mkdirp(path.join(VENDOR_DIR, 'league', 'config', 'src'));
  mkdirp(path.join(VENDOR_DIR, 'psr', 'event-dispatcher', 'src'));
  mkdirp(path.join(VENDOR_DIR, 'symfony', 'deprecation-contracts'));
  mkdirp(path.join(VENDOR_DIR, 'symfony', 'polyfill-php80'));
  mkdirp(path.join(VENDOR_DIR, 'dflydev', 'dot-access-data', 'src'));
  mkdirp(path.join(VENDOR_DIR, 'nette', 'schema', 'src'));
  mkdirp(path.join(VENDOR_DIR, 'nette', 'utils', 'src'));

  await downloadAndExtract(
    'league/commonmark v2.4.2',
    'https://github.com/thephpleague/commonmark/archive/refs/tags/2.4.2.zip',
    'commonmark.zip',
    path.join(VENDOR_DIR, 'league', 'commonmark')
  );

  await downloadAndExtract(
    'erusev/parsedown v1.7.4',
    'https://github.com/erusev/parsedown/archive/refs/tags/1.7.4.zip',
    'parsedown.zip',
    path.join(VENDOR_DIR, 'erusev', 'parsedown')
  );

  await downloadAndExtract(
    'league/config v1.2.0',
    'https://github.com/thephpleague/config/archive/refs/tags/v1.2.0.zip',
    'config.zip',
    path.join(VENDOR_DIR, 'league', 'config')
  );

  await downloadAndExtract(
    'psr/event-dispatcher v1.0.0',
    'https://github.com/php-fig/event-dispatcher/archive/refs/tags/1.0.0.zip',
    'psr-event-dispatcher.zip',
    path.join(VENDOR_DIR, 'psr', 'event-dispatcher')
  );

  await downloadAndExtract(
    'symfony/deprecation-contracts v3.4.0',
    'https://github.com/symfony/deprecation-contracts/archive/refs/tags/v3.4.0.zip',
    'symfony-deprecation-contracts.zip',
    path.join(VENDOR_DIR, 'symfony', 'deprecation-contracts')
  );

  await downloadAndExtract(
    'symfony/polyfill-php80 v1.29.0',
    'https://github.com/symfony/polyfill-php80/archive/refs/tags/v1.29.0.zip',
    'symfony-polyfill-php80.zip',
    path.join(VENDOR_DIR, 'symfony', 'polyfill-php80')
  );

  await downloadAndExtract(
    'dflydev/dot-access-data v3.0.3',
    'https://github.com/dflydev/dflydev-dot-access-data/archive/refs/tags/v3.0.3.zip',
    'dflydev-dot-access-data.zip',
    path.join(VENDOR_DIR, 'dflydev', 'dot-access-data')
  );

  await downloadAndExtract(
    'nette/schema v1.2.5',
    'https://github.com/nette/schema/archive/refs/tags/v1.2.5.zip',
    'nette-schema.zip',
    path.join(VENDOR_DIR, 'nette', 'schema')
  );

  await downloadAndExtract(
    'nette/utils v3.2.10',
    'https://github.com/nette/utils/archive/refs/tags/v3.2.10.zip',
    'nette-utils.zip',
    path.join(VENDOR_DIR, 'nette', 'utils')
  );

  console.log('Libraries bundled successfully.');
}

main().catch(console.error);
