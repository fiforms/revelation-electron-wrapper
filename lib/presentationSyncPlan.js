// Three-way sync planning between a local presentation, a remote copy, and the last
// synced snapshot of that remote ("base"). Pure: no I/O, so it can be tested directly.
//
// Phase 2 never deletes files on either side:
// - A file deleted locally is left out of the pushed manifest, but only if the remote
//   hasn't changed it since the base. If it has, the remote copy is pulled back.
// - A file missing remotely is pushed back.
//
// Without a base (first sync against this peer), newer `modified` wins. Remote-only files
// are dropped, not pulled, matching the old publish behavior where the remote manifest
// was simply the last local manifest pushed.

const MANIFEST_FILENAME = 'manifest.json';

function isSyncablePath(filename) {
  const rel = String(filename || '');
  if (!rel || rel === MANIFEST_FILENAME) return false;
  return !rel.split('/').some((part) => !part || part.startsWith('.') || part === '..');
}

function toFileMap(files) {
  const map = new Map();
  for (const entry of Array.isArray(files) ? files : []) {
    if (entry && isSyncablePath(entry.filename)) {
      map.set(entry.filename, entry);
    }
  }
  return map;
}

function sameContent(a, b) {
  return !!(a && b && a.sha1 && b.sha1 && a.sha1 === b.sha1);
}

function modifiedMs(entry) {
  const ms = Date.parse(String(entry?.modified || ''));
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * @param {object} input
 * @param {Array} input.localFiles    local manifest entries ({ filename, modified, size, sha1 })
 * @param {Array} input.remoteFiles   remote manifest entries, hashed by the server
 * @param {Array|null} input.baseFiles entries from the last successful sync, or null if none
 * @param {Array|null} input.acceptedFiles filenames the remote will accept; null means all
 * @returns {{ push: Array, pull: Array, conflicts: Array, dropped: string[], unchanged: number }}
 */
function computeSyncPlan({ localFiles, remoteFiles, baseFiles = null, acceptedFiles = null }) {
  const local = toFileMap(localFiles);
  const remote = toFileMap(remoteFiles);
  const hasBase = Array.isArray(baseFiles);
  const base = toFileMap(baseFiles);
  const accepted = Array.isArray(acceptedFiles) ? new Set(acceptedFiles) : null;
  const canPush = (filename) => !accepted || accepted.has(filename);

  const plan = { push: [], pull: [], conflicts: [], dropped: [], unchanged: 0 };
  const names = [...new Set([...local.keys(), ...remote.keys()])].sort();

  for (const filename of names) {
    const l = local.get(filename);
    const r = remote.get(filename);
    const b = base.get(filename);

    if (l && r) {
      if (sameContent(l, r)) {
        plan.unchanged += 1;
      } else if (!hasBase) {
        if (modifiedMs(r) > modifiedMs(l)) plan.pull.push(r);
        else if (canPush(filename)) plan.push.push(l);
      } else if (sameContent(l, b)) {
        plan.pull.push(r);
      } else if (sameContent(r, b)) {
        if (canPush(filename)) plan.push.push(l);
      } else {
        plan.conflicts.push({ filename, local: l, remote: r, base: b || null });
      }
      continue;
    }

    if (l) {
      if (canPush(filename)) plan.push.push(l);
      continue;
    }

    // Remote only.
    if (!hasBase || (b && sameContent(r, b))) {
      plan.dropped.push(filename);
    } else {
      plan.pull.push(r);
    }
  }

  return plan;
}

module.exports = {
  computeSyncPlan,
  isSyncablePath
};
