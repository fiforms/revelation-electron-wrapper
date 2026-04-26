const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

function loadOldManifestCache(manifestPath) {
  if (!fs.existsSync(manifestPath)) return new Map();
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const cache = new Map();
    if (Array.isArray(data.files)) {
      for (const entry of data.files) {
        if (entry.filename && entry.sha1) {
          cache.set(entry.filename, entry);
        }
      }
    }
    return cache;
  } catch {
    return new Map();
  }
}

async function collectManifestFiles(presentationDir) {
  const root = path.resolve(presentationDir);
  const manifestPath = path.join(root, MANIFEST_FILENAME);
  const oldCache = loadOldManifestCache(manifestPath);

  const filePaths = [];
  const walk = (dirPath) => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const absolutePath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relPosix = toPosixPath(path.relative(root, absolutePath));
      if (!shouldIncludeInManifest(relPosix)) continue;
      filePaths.push({ absolutePath, relPosix });
    }
  };
  walk(root);

  const files = [];
  for (const { absolutePath, relPosix } of filePaths) {
    const stats = fs.statSync(absolutePath);
    const size = stats.size;
    const modified = stats.mtime.toISOString();
    const cached = oldCache.get(relPosix);
    const sha1 = (cached && cached.size === size && cached.modified === modified)
      ? cached.sha1
      : await hashFile(absolutePath);
    files.push({ filename: relPosix, size, modified, sha1 });
  }

  // manifest.json has no sha1 — it would be self-referential and isn't yet written
  const manifestStats = fs.existsSync(manifestPath) ? fs.statSync(manifestPath) : null;
  files.push({
    filename: MANIFEST_FILENAME,
    size: manifestStats ? manifestStats.size : 0,
    modified: manifestStats ? manifestStats.mtime.toISOString() : new Date().toISOString()
  });

  files.sort((a, b) => a.filename.localeCompare(b.filename));
  return files;
}

async function buildPresentationManifest(presentationDir, data = {}) {
  return {
    ...data,
    files: await collectManifestFiles(presentationDir)
  };
}

async function writePresentationManifest(presentationDir, data = {}) {
  const manifest = await buildPresentationManifest(presentationDir, data);
  const manifestPath = path.join(presentationDir, MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}

module.exports = {
  MANIFEST_FILENAME,
  buildPresentationManifest,
  writePresentationManifest
};
