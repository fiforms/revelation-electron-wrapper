// Path-confinement helpers for names and paths that come from outside the app: renderer IPC
// arguments, imported front matter, media sidecars, archive entries. Pure Node (no Electron), so
// tests can load it directly.
//
//   isSafeBasename(name)        true only for a plain file name: no separators, no "."/"..", no drive
//                               prefix, no NUL.
//   assertSafeBasename(name)    same, but throws and returns the name.
//   assertSafeMediaFilename(n)  basename rule plus revelFormat's prohibited-type list. Use for names that
//   isSafeMediaFilename(n)      end up inside the shared `_media` library (which is flat). The second is
//                               the non-throwing form for loops that skip bad entries.
//   resolveInside(base, ...p)   resolve and throw unless the result is strictly inside `base`.
//   resolvePresentationDir(root, slug)         <root>/<slug>; slug must be a plain folder name.
//   resolvePresentationFile(root, slug, md)    <root>/<slug>/<md>; md may have subfolders but not escape.
//
// Limits: these are lexical checks. They do not resolve symlinks, so a symlink already inside the
// target directory can still point elsewhere.
// Background and the other places that still need this: doc/dev/KNOWN_ISSUES.md (S1, S5) and
// doc/dev/REFACTOR_CANDIDATES.md (section 1, path safety).
const path = require('path');
const { isProhibitedName } = require('./revelFormat');

const MAX_NAME_LENGTH = 255;

function isSafeBasename(name) {
  if (typeof name !== 'string' || !name || name.length > MAX_NAME_LENGTH) return false;
  if (name === '.' || name === '..') return false;
  if (/[\\/\0]/.test(name)) return false;
  if (/^[a-zA-Z]:/.test(name)) return false; // "C:foo" is drive-relative on Windows
  return true;
}

function describe(value) {
  return JSON.stringify(String(value).slice(0, 80));
}

function assertSafeBasename(name, label = 'file name') {
  if (!isSafeBasename(name)) throw new Error(`Unsafe ${label}: ${describe(name)}`);
  return name;
}

function assertSafeMediaFilename(name, label = 'media filename') {
  assertSafeBasename(name, label);
  if (isProhibitedName(name)) throw new Error(`File type not allowed for ${label}: ${describe(name)}`);
  return name;
}

function isSafeMediaFilename(name) {
  return isSafeBasename(name) && !isProhibitedName(name);
}

function resolveInside(base, ...parts) {
  const baseAbs = path.resolve(base);
  const target = path.resolve(baseAbs, ...parts);
  const rel = path.relative(baseAbs, target);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path escapes its folder: ${describe(parts.join('/'))}`);
  }
  return target;
}

function resolvePresentationDir(presentationsDir, slug) {
  if (!presentationsDir) throw new Error('Presentations directory not configured');
  assertSafeBasename(slug, 'presentation slug');
  return resolveInside(presentationsDir, slug);
}

function resolvePresentationFile(presentationsDir, slug, mdFile) {
  if (typeof mdFile !== 'string' || !mdFile) throw new Error('Markdown file not provided');
  return resolveInside(resolvePresentationDir(presentationsDir, slug), mdFile);
}

module.exports = { resolvePresentationDir, resolvePresentationFile, isSafeBasename, assertSafeBasename, isSafeMediaFilename, assertSafeMediaFilename, resolveInside };
