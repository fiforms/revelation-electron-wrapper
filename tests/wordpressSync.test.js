// wordpress_publish main half: fetchJson timeouts, and the publish/sync backup + keep-server rules,
// run against a fake WordPress server on loopback (no Electron, no network).
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { installElectronStub } = require('./helpers/electron-stub');
const { tmpDir } = require('./helpers/paths');

installElectronStub();
const { generateKeyPair } = require('../lib/peerAuth');
const plugin = require('../plugins/wordpress_publish/plugin.js');
const { fetchJson, publishPresentationToSite, keepLocalInBase, setAppContext } = plugin._testing;

const keys = generateKeyPair();
setAppContext({ config: { rsaPrivateKey: keys.privateKey, rsaPublicKey: keys.publicKey }, warn() {} });

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const listen = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(server));
});
const url = (server, p = '/') => `http://127.0.0.1:${server.address().port}${p}`;

test('fetchJson times out with a message naming the operation, and keeps the idle semantics', async () => {
  const server = await listen(() => { /* never answers */ });
  try {
    await assert.rejects(
      fetchJson(url(server), { method: 'POST', body: {}, timeoutMs: 100, what: 'Uploading "a.mp4" (chunk 2/3)' }),
      /Uploading "a\.mp4" \(chunk 2\/3\) timed out: no data sent or received for 0 s/
    );
    await assert.rejects(fetchJson(url(server), { timeoutMs: 100 }), /^Error: WordPress request timed out/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('fetchJson: a response that keeps trickling in past timeoutMs is not aborted', async () => {
  const server = await listen((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"a":');
    setTimeout(() => res.write('"b"'), 120);
    setTimeout(() => res.end('}'), 240);
  });
  try {
    assert.deepStrictEqual(await fetchJson(url(server), { timeoutMs: 200 }), { a: 'b' });
  } finally {
    server.close();
  }
});

test('keepLocalInBase swaps only the named files for the local hash', () => {
  const base = [{ filename: 'a.html', size: 1, sha1: 'srv' }, { filename: 'b.md', size: 2, sha1: 'srv2' }];
  assert.deepStrictEqual(keepLocalInBase(base, [{ filename: 'a.html', size: 9, sha1: 'loc', modified: 'x' }]), [
    { filename: 'a.html', size: 9, sha1: 'loc' },
    { filename: 'b.md', size: 2, sha1: 'srv2' }
  ]);
});

// Fake WordPress: remote = Map(filename -> { content, modified }).
async function fakeSite(remote) {
  const uploads = [];
  const listing = () => [...remote].map(([filename, v]) => ({ filename, size: v.content.length, sha1: sha1(v.content), modified: v.modified }));
  const server = await listen((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url.endsWith('/publish/check')) return send({ syncProtocol: 1, revision: 1, remoteSlug: 'pres', remoteFiles: listing() });
      if (req.url.endsWith('/publish/pull')) {
        const v = remote.get(body.filename);
        return send({ contentBase64: Buffer.from(v.content).toString('base64'), eof: true });
      }
      if (req.url.endsWith('/publish/file')) {
        uploads.push(body.filename);
        remote.set(body.filename, { content: Buffer.from(body.contentBase64, 'base64').toString(), modified: body.modified });
        return send({});
      }
      if (req.url.endsWith('/publish/commit')) return send({ revision: 2, remoteFiles: listing(), presentationUrl: 'x' });
      res.writeHead(404); res.end('{}');
    });
  });
  return { server, uploads, base: url(server) };
}

function presentation(files) {
  const dir = tmpDir('wp-sync-');
  for (const [name, { content, mtime }] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    fs.utimesSync(p, new Date(mtime), new Date(mtime));
  }
  return { slug: 'pres', mdFile: 'p.md', presentationDir: dir };
}
const pairing = { pairingId: 'pid', publishToken: 'tok', siteName: 'T' };
const backups = (dir) => {
  const root = path.join(dir, '.sync-conflicts');
  if (!fs.existsSync(root)) return {};
  const out = {};
  for (const stamp of fs.readdirSync(root)) {
    for (const f of fs.readdirSync(path.join(root, stamp), { recursive: true })) {
      const full = path.join(root, stamp, f);
      if (fs.statSync(full).isFile()) out[f] = fs.readFileSync(full, 'utf-8');
    }
  }
  return out;
};

test('no-base sync: the mtime loser is backed up on both sides (remote overwritten, local overwritten)', async () => {
  process.env.REVELATION_SYNC_STORE_PATH = path.join(tmpDir('wp-store-'), 'sync-peers.json');
  const old = '2026-01-01T00:00:00Z';
  const recent = '2026-02-01T00:00:00Z';
  const remote = new Map([
    ['p.md', { content: 'remote-old', modified: old }], // local newer -> pushed over this
    ['n.md', { content: 'remote-new', modified: recent }] // remote newer -> pulled over local
  ]);
  const site = await fakeSite(remote);
  try {
    const pres = presentation({
      'p.md': { content: 'local-new', mtime: recent },
      'n.md': { content: 'local-old', mtime: old }
    });
    const result = await publishPresentationToSite(site.base, pairing, pres);
    assert.deepStrictEqual(site.uploads, ['p.md']);
    assert.strictEqual(fs.readFileSync(path.join(pres.presentationDir, 'n.md'), 'utf-8'), 'remote-new');
    assert.deepStrictEqual(backups(pres.presentationDir), { 'p.md': 'remote-old', 'n.md': 'local-old' });
    assert.match(result.conflictBackupDir, /^\.sync-conflicts\//);
  } finally {
    site.server.close();
    delete process.env.REVELATION_SYNC_STORE_PATH;
  }
});

test('keep-server on a non-pullable conflict leaves the server copy alone now and on the next sync', async () => {
  process.env.REVELATION_SYNC_STORE_PATH = path.join(tmpDir('wp-store-'), 'sync-peers.json');
  const old = '2026-01-01T00:00:00Z';
  const remote = new Map([['p.md', { content: 'same', modified: old }], ['slide.html', { content: '<p>v0</p>', modified: old }]]);
  const site = await fakeSite(remote);
  try {
    const pres = presentation({ 'p.md': { content: 'same', mtime: old }, 'slide.html': { content: '<p>v0</p>', mtime: old } });
    await publishPresentationToSite(site.base, pairing, pres); // establishes the base
    site.uploads.length = 0;

    fs.writeFileSync(path.join(pres.presentationDir, 'slide.html'), '<p>local</p>');
    remote.set('slide.html', { content: '<p>server</p>', modified: '2026-03-01T00:00:00Z' });
    const r2 = await publishPresentationToSite(site.base, pairing, pres, { resolveConflicts: async () => 'remote' });
    assert.strictEqual(r2.conflictCount, 1);
    assert.deepStrictEqual(site.uploads, []);
    assert.strictEqual(fs.readFileSync(path.join(pres.presentationDir, 'slide.html'), 'utf-8'), '<p>local</p>', 'never written locally');
    assert.ok(Object.values(backups(pres.presentationDir)).includes('<p>local</p>'));

    await publishPresentationToSite(site.base, pairing, pres, { resolveConflicts: async () => assert.fail('no conflict expected') });
    assert.deepStrictEqual(site.uploads, [], 'the next sync does not push the local copy over the server');
    assert.strictEqual(remote.get('slide.html').content, '<p>server</p>');
  } finally {
    site.server.close();
    delete process.env.REVELATION_SYNC_STORE_PATH;
  }
});
