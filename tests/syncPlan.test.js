// Three-way sync planning (lib/presentationSyncPlan.js) plus the per-machine peer store.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { computeSyncPlan, isSyncablePath } = require('../lib/presentationSyncPlan');
const { tmpDir } = require('./helpers/paths');

const f = (filename, sha1, modified = '2026-01-01T00:00:00Z') => ({ filename, sha1, modified, size: 1 });
const names = (list) => list.map((e) => e.filename);

test('isSyncablePath rejects manifest, hidden and traversal paths', () => {
  assert.ok(isSyncablePath('a.md'));
  assert.ok(isSyncablePath('_media/a.png'));
  for (const bad of ['', 'manifest.json', '.thumbs/a.png', 'a/.x', '../a', 'a//b', 'a/../b']) {
    assert.ok(!isSyncablePath(bad), JSON.stringify(bad));
  }
});

test('identical content is unchanged', () => {
  const plan = computeSyncPlan({ localFiles: [f('a', '1')], remoteFiles: [f('a', '1')], baseFiles: [f('a', '1')] });
  assert.strictEqual(plan.unchanged, 1);
  assert.deepStrictEqual([plan.push, plan.pull, plan.conflicts], [[], [], []]);
});

test('with a base: local-only change pushes, remote-only change pulls, both change conflicts', () => {
  const base = [f('a', '1')];
  assert.deepStrictEqual(names(computeSyncPlan({ localFiles: [f('a', '2')], remoteFiles: [f('a', '1')], baseFiles: base }).push), ['a']);
  assert.deepStrictEqual(names(computeSyncPlan({ localFiles: [f('a', '1')], remoteFiles: [f('a', '2')], baseFiles: base }).pull), ['a']);
  const c = computeSyncPlan({ localFiles: [f('a', '2')], remoteFiles: [f('a', '3')], baseFiles: base });
  assert.strictEqual(c.conflicts.length, 1);
  assert.strictEqual(c.conflicts[0].filename, 'a');
});

test('without a base: newer modified wins; local-only pushes; remote-only is dropped', () => {
  const older = '2026-01-01T00:00:00Z';
  const newer = '2026-02-01T00:00:00Z';
  const plan = computeSyncPlan({
    localFiles: [f('l-newer', '1', newer), f('r-newer', '1', older), f('only-local', '9')],
    remoteFiles: [f('l-newer', '2', older), f('r-newer', '2', newer), f('only-remote', '8')],
    baseFiles: null
  });
  assert.deepStrictEqual(names(plan.push).sort(), ['l-newer', 'only-local']);
  assert.deepStrictEqual(names(plan.pull), ['r-newer']);
  assert.deepStrictEqual(plan.dropped, ['only-remote']);
});

test('deletion safety: a local delete is never pushed as a remote delete; remote-changed file comes back', () => {
  const base = [f('a', '1'), f('b', '1')];
  const plan = computeSyncPlan({ localFiles: [], remoteFiles: [f('a', '1'), f('b', '2')], baseFiles: base });
  assert.deepStrictEqual(names(plan.pull), ['b'], 'remote-modified file is pulled back');
  assert.deepStrictEqual(plan.dropped, ['a'], 'untouched remote file is left out of the manifest');
  assert.deepStrictEqual(plan.push, []);
});

test('file missing remotely is pushed back; acceptedFiles filters pushes', () => {
  const plan = computeSyncPlan({ localFiles: [f('a', '1'), f('b', '1')], remoteFiles: [], baseFiles: [], acceptedFiles: ['a'] });
  assert.deepStrictEqual(names(plan.push), ['a']);
});

test('remote-only file added since base is pulled', () => {
  const plan = computeSyncPlan({ localFiles: [], remoteFiles: [f('new', '5')], baseFiles: [] });
  assert.deepStrictEqual(names(plan.pull), ['new']);
});

test('non-syncable paths are ignored entirely', () => {
  const plan = computeSyncPlan({ localFiles: [f('.hidden', '1'), f('manifest.json', '1')], remoteFiles: [f('../x', '2')], baseFiles: [] });
  assert.deepStrictEqual([plan.push, plan.pull, plan.conflicts, plan.dropped], [[], [], [], []]);
});

test('presentationSyncPeers upsert/find/list round trip via REVELATION_SYNC_STORE_PATH', () => {
  const dir = tmpDir();
  process.env.REVELATION_SYNC_STORE_PATH = path.join(dir, 'store', 'sync-peers.json');
  try {
    const peers = require('../lib/presentationSyncPeers');
    const pres = path.join(dir, 'pres');
    fs.mkdirSync(pres);
    assert.deepStrictEqual(peers.listSyncPeers(pres), []);
    assert.throws(() => peers.upsertSyncPeer(pres, {}), /kind/);

    const wp = { kind: 'wordpress', siteBaseUrl: 'https://a.example', remoteSlug: 's', base: [f('a', '1')] };
    const first = peers.upsertSyncPeer(pres, wp);
    const second = peers.upsertSyncPeer(pres, { ...wp, base: [f('a', '2')] });
    peers.upsertSyncPeer(pres, { kind: 'url', baseUrl: 'https://b.example' });

    assert.strictEqual(peers.listSyncPeers(pres).length, 2, 'same kind+location updates in place');
    assert.strictEqual(second.addedAt, first.addedAt);
    assert.deepStrictEqual(peers.findSyncPeer(pres, wp).base, [f('a', '2')]);
    assert.strictEqual(peers.findSyncPeer(pres, { kind: 'wordpress', siteBaseUrl: 'https://other', remoteSlug: 's' }), null);
  } finally {
    delete process.env.REVELATION_SYNC_STORE_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('presentationSyncPeers ignores a corrupt store file', () => {
  const dir = tmpDir();
  const store = path.join(dir, 'sync-peers.json');
  fs.writeFileSync(store, '{not json');
  process.env.REVELATION_SYNC_STORE_PATH = store;
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepStrictEqual(require('../lib/presentationSyncPeers').listSyncPeers(dir), []);
  } finally {
    console.warn = warn;
    delete process.env.REVELATION_SYNC_STORE_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
