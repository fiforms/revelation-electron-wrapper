const fs = require('fs');
const path = require('path');

const MANIFEST_FILENAME = 'manifest.json';
const RESOURCES_DIRNAME = '_resources';
const RESOURCES_MEDIA_DIR = '_resources/_media';
const BUILDER_TEMP_FILENAME = '__builder_temp.md';

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function shouldIncludeInManifest(relPathPosix) {
  if (!relPathPosix) return false;
  if (relPathPosix === MANIFEST_FILENAME) return false;
  if (path.posix.basename(relPathPosix) === BUILDER_TEMP_FILENAME) return false;
  if (!relPathPosix.startsWith(`${RESOURCES_DIRNAME}/`)) return true;
  return relPathPosix.startsWith(`${RESOURCES_MEDIA_DIR}/`);
}

function collectManifestFiles(presentationDir) {
  const root = path.resolve(presentationDir);
  const files = [];

  const walk = (dirPath) => {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(root, absolutePath);
      const relPosix = toPosixPath(relativePath);
      if (!shouldIncludeInManifest(relPosix)) continue;
      files.push(relPosix);
    }
  };

  walk(root);
  files.push(MANIFEST_FILENAME);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function buildPresentationManifest(presentationDir, data = {}) {
  return {
    ...data,
    files: collectManifestFiles(presentationDir)
  };
}

function writePresentationManifest(presentationDir, data = {}) {
  const manifest = buildPresentationManifest(presentationDir, data);
  const manifestPath = path.join(presentationDir, MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}

module.exports = {
  MANIFEST_FILENAME,
  buildPresentationManifest,
  writePresentationManifest
};
