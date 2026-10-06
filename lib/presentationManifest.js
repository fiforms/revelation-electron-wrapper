const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Builds and writes a presentation's manifest.json: presentationId + a `files` index
// (filename, size, modified, sha1). Exports: MANIFEST_FILENAME, buildPresentationManifest
// (in memory; supports exclude/overrides for .revel export), writePresentationManifest.
// Callers: exportPresentation.js, presentationBuilderWindow.js (on save) and
// plugins/wordpress_publish (publish/sync). The sha1 of unchanged files is reused from the old
// manifest when size and mtime match (pass forceRecompute to skip that cache).
// manifest.json is part of the .revel file format; see doc/dev/REVEL_FORMAT.md before changing its fields.
const MANIFEST_FILENAME = 'manifest.json';
const RESOURCES_DIRNAME = '_resources';
const RESOURCES_MEDIA_DIR = '_resources/_media';
const BUILDER_TEMP_FILENAME = '__builder_temp.md';

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

// Which files the manifest lists. The same rules are mirrored in revelFormat.planRevelContents and
// presentationSyncPlan.isSyncablePath; keep them consistent.
function shouldIncludeInManifest(relPathPosix) {
  if (!relPathPosix) return false;
  if (relPathPosix === MANIFEST_FILENAME) return false;
  if (path.posix.basename(relPathPosix) === BUILDER_TEMP_FILENAME) return false;
  // Dot-prefixed paths are local-only state (.thumbs, sync sidecar, sync conflicts, temp downloads)
  // and are rejected by the WordPress publish endpoint anyway.
  if (relPathPosix.split('/').some((part) => part.startsWith('.'))) return false;
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

// `exclude(relPosix)` drops a file from the listing (used by .revel export for files that are
// omitted from the archive). `overrides` maps relPosix to a Buffer holding the content that is
// actually archived when it differs from the file on disk (a sanitized SVG), so size and sha1
// describe the archived bytes.
async function collectManifestFiles(presentationDir, { forceRecompute = false, exclude = null, overrides = null } = {}) {
  const root = path.resolve(presentationDir);
  const manifestPath = path.join(root, MANIFEST_FILENAME);
  const oldCache = forceRecompute ? new Map() : loadOldManifestCache(manifestPath);

  const filePaths = [];
  const walk = (dirPath) => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const absolutePath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relPosix = toPosixPath(path.relative(root, absolutePath));
      if (!shouldIncludeInManifest(relPosix)) continue;
      if (exclude && exclude(relPosix)) continue;
      filePaths.push({ absolutePath, relPosix });
    }
  };
  walk(root);

  const files = [];
  for (const { absolutePath, relPosix } of filePaths) {
    const stats = fs.statSync(absolutePath);
    const override = overrides && overrides.get(relPosix);
    const size = override ? override.length : stats.size;
    const modified = stats.mtime.toISOString();
    const cached = oldCache.get(relPosix);
    const sha1 = override
      ? crypto.createHash('sha1').update(override).digest('hex')
      : ((cached && cached.size === size && cached.modified === modified)
        ? cached.sha1
        : await hashFile(absolutePath));
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

const PRESENTATION_ID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function normalizePresentationId(value) {
  const id = String(value || '').trim().toLowerCase();
  return PRESENTATION_ID_RE.test(id) ? id : '';
}

function readExistingPresentationId(manifestPath) {
  try {
    return normalizePresentationId(JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))?.presentationId);
  } catch {
    return '';
  }
}

// presentationId is a persistent identity for the presentation. It is created once and kept
// across manifest rewrites, and travels with the folder (cloud sync, ZIP, Import from URL),
// so hosted copies can tell "same presentation" apart from a slug name collision.
async function buildPresentationManifest(presentationDir, data = {}, { forceRecompute = false, exclude = null, overrides = null } = {}) {
  const manifestPath = path.join(path.resolve(presentationDir), MANIFEST_FILENAME);
  const presentationId = normalizePresentationId(data.presentationId)
    || readExistingPresentationId(manifestPath)
    || crypto.randomUUID();
  return {
    ...data,
    presentationId,
    files: await collectManifestFiles(presentationDir, { forceRecompute, exclude, overrides })
  };
}

async function writePresentationManifest(presentationDir, data = {}, { forceRecompute = false } = {}) {
  const manifest = await buildPresentationManifest(presentationDir, data, { forceRecompute });
  const manifestPath = path.join(presentationDir, MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}

module.exports = {
  MANIFEST_FILENAME,
  buildPresentationManifest,
  writePresentationManifest
};
