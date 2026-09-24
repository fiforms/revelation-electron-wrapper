const fs = require('fs');
const path = require('path');

// Per-machine record of where each presentation has been published to or imported from,
// including the last-synced base snapshot for each peer. Kept in app storage, not in the
// presentation folder: presentation folders are often cloud-synced (Nextcloud, Dropbox),
// and a base that arrives on another machine ahead of the files it describes would make
// that machine push stale content.
const SYNC_STORE_FILENAME = 'sync-peers.json';
const SYNC_STORE_VERSION = 1;
// Where sync saves the losing side of a conflict, so a resolution never destroys content.
// This one does live in the presentation folder, so backups travel with it.
const SYNC_CONFLICTS_DIRNAME = '.sync-conflicts';

function storePath() {
  if (process.env.REVELATION_SYNC_STORE_PATH) {
    return process.env.REVELATION_SYNC_STORE_PATH;
  }
  const { app } = require('electron');
  return path.join(app.getPath('userData'), SYNC_STORE_FILENAME);
}

// Entries are keyed by the presentation's resolved folder path. Moving or renaming the
// folder orphans its entry, and the next publish then behaves like a first sync.
function presentationKey(presentationDir) {
  const resolved = path.resolve(presentationDir);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function readStore() {
  const filePath = storePath();
  if (!fs.existsSync(filePath)) {
    return { version: SYNC_STORE_VERSION, presentations: {} };
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const presentations = data?.presentations && typeof data.presentations === 'object' ? data.presentations : {};
    return { ...data, version: SYNC_STORE_VERSION, presentations };
  } catch (err) {
    console.warn(`[presentationSyncPeers] Ignoring unreadable ${filePath}: ${err.message}`);
    return { version: SYNC_STORE_VERSION, presentations: {} };
  }
}

function writeStore(store) {
  const filePath = storePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tempPath, filePath);
}

function peersFor(store, key) {
  const peers = store.presentations[key]?.peers;
  return Array.isArray(peers) ? peers.filter((p) => p && typeof p === 'object') : [];
}

function peerKey(peer) {
  if (peer.kind === 'wordpress') {
    return `wordpress|${peer.siteBaseUrl || ''}|${peer.remoteSlug || ''}`;
  }
  return `${peer.kind || 'url'}|${peer.baseUrl || ''}`;
}

// Insert or update a peer, matched by kind + location. Returns the stored peer.
function upsertSyncPeer(presentationDir, peer) {
  if (!peer || typeof peer !== 'object' || !peer.kind) {
    throw new Error('Sync peer requires a kind.');
  }
  const now = new Date().toISOString();
  const key = presentationKey(presentationDir);
  const store = readStore();
  const peers = peersFor(store, key);
  const index = peers.findIndex((existing) => peerKey(existing) === peerKey(peer));
  const previous = index >= 0 ? peers[index] : null;
  const stored = {
    ...(previous || {}),
    ...peer,
    addedAt: previous?.addedAt || now,
    updatedAt: now
  };
  if (index >= 0) {
    peers[index] = stored;
  } else {
    peers.push(stored);
  }
  store.presentations[key] = { ...(store.presentations[key] || {}), peers };
  writeStore(store);
  return stored;
}

function findSyncPeer(presentationDir, peer) {
  const target = peerKey(peer);
  return peersFor(readStore(), presentationKey(presentationDir)).find((existing) => peerKey(existing) === target) || null;
}

function listSyncPeers(presentationDir) {
  return peersFor(readStore(), presentationKey(presentationDir));
}

module.exports = {
  SYNC_CONFLICTS_DIRNAME,
  findSyncPeer,
  listSyncPeers,
  upsertSyncPeer
};
