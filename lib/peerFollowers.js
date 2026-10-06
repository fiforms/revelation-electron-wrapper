// Master-side view of paired followers (peer protocol v2).
//
// The store (userData/peer-followers.json) is owned by the Vite process, which
// enrolls followers and records when they connect (revelation/server/peer-server.js).
// This module only reads it, and asks the Vite process to forget followers so
// their live connections are dropped at the same time. When the Vite process
// is not running there is no other writer, so the file is edited directly.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { serverManager } = require('./serverManager');
const { fingerprintPublicKey } = require('./peerAuth');

function followersPath() {
  return path.join(app.getPath('userData'), 'peer-followers.json');
}

function readStore() {
  const file = followersPath();
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(parsed?.followers) ? parsed.followers.filter((f) => f && f.instanceId) : [];
  } catch {
    return [];
  }
}

function listPairedFollowers() {
  return readStore()
    .map((f) => ({
      instanceId: String(f.instanceId),
      name: String(f.name || ''),
      pairedAt: f.pairedAt || null,
      lastSeenAt: f.lastSeenAt || null,
      lastAddress: f.lastAddress || null,
      keyFingerprint: typeof f.publicKey === 'string' ? fingerprintPublicKey(f.publicKey).slice(0, 16) : ''
    }))
    .sort((a, b) => String(b.lastSeenAt || b.pairedAt || '').localeCompare(String(a.lastSeenAt || a.pairedAt || '')));
}

// instanceId null → forget every follower. Resolves once the store is updated.
async function forgetFollowers(instanceId = null) {
  if (!serverManager.viteProc) {
    const remaining = instanceId ? readStore().filter((f) => f.instanceId !== instanceId) : [];
    const file = followersPath();
    if (fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify({ version: 1, followers: remaining }, null, 2));
    }
    return;
  }
  await serverManager.requestVite(instanceId
    ? { type: 'peer-forget-follower', instanceId }
    : { type: 'peer-forget-all-followers' });
}

module.exports = { listPairedFollowers, forgetFollowers };
