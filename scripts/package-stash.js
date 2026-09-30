// Holding area for files that are pruned from the working tree during packaging.
// Instead of deleting, prepackage moves (or copies) them here and package.js
// puts them back once electron-builder finishes, so the tree stays usable.
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const stashDir = path.join(rootDir, '.package-stash');
const manifestPath = path.join(stashDir, 'manifest.json');

// Entries: { original, stashed, mode: 'moved' | 'copied' }
//   moved:  original was renamed into the stash; restore renames it back.
//   copied: original was left in place (and then modified, e.g. by npm prune);
//           restore replaces original with the stashed copy.
function readManifest() {
  if (!fs.existsSync(manifestPath)) return [];
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function writeManifest(entries) {
  fs.mkdirSync(stashDir, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(entries, null, 2) + '\n', 'utf8');
}

function hasPendingStash() {
  return fs.existsSync(manifestPath);
}

function register(originalPath, mode, place) {
  const entries = readManifest();
  const slot = path.join(stashDir, String(entries.length).padStart(4, '0'));
  fs.mkdirSync(slot, { recursive: true });
  const stashed = path.join(slot, path.basename(originalPath));
  // Record before touching anything so an interrupted run can still be restored.
  entries.push({ original: path.relative(rootDir, originalPath), stashed: path.relative(rootDir, stashed), mode });
  writeManifest(entries);
  place(originalPath, stashed);
}

// Move a file or directory into the stash (no-op if missing).
function stashMove(originalPath) {
  if (!fs.existsSync(originalPath)) return false;
  register(originalPath, 'moved', (from, to) => fs.renameSync(from, to));
  return true;
}

// Copy a file or directory into the stash, leaving the original in place.
function stashCopy(originalPath) {
  if (!fs.existsSync(originalPath)) return false;
  register(originalPath, 'copied', (from, to) =>
    fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true }));
  return true;
}

function restoreAll() {
  if (!hasPendingStash()) return 0;
  const entries = readManifest();
  let restored = 0;
  // Reverse order so nested items unwind correctly.
  for (const entry of entries.slice().reverse()) {
    const original = path.join(rootDir, entry.original);
    const stashed = path.join(rootDir, entry.stashed);
    if (!fs.existsSync(stashed)) {
      console.warn(`⚠️  Stashed item missing, cannot restore: ${entry.stashed}`);
      continue;
    }
    if (fs.existsSync(original)) {
      if (entry.mode === 'moved') {
        console.warn(`⚠️  ${entry.original} was recreated during packaging; keeping the stashed copy at ${entry.stashed}`);
        continue;
      }
      fs.rmSync(original, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(original), { recursive: true });
    fs.renameSync(stashed, original);
    restored++;
  }
  // Only discard the stash if every item made it back.
  const leftovers = entries.filter((e) => fs.existsSync(path.join(rootDir, e.stashed)));
  if (leftovers.length === 0) {
    fs.rmSync(stashDir, { recursive: true, force: true });
  } else {
    console.warn(`⚠️  ${leftovers.length} item(s) remain in ${path.relative(rootDir, stashDir)}/ for manual recovery.`);
  }
  return restored;
}

module.exports = { stashMove, stashCopy, restoreAll, hasPendingStash, stashDir };

if (require.main === module) {
  const n = restoreAll();
  console.log(n ? `♻️  Restored ${n} item(s) from the package stash.` : 'Nothing to restore.');
}
