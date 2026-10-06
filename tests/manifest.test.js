// presentationManifest: file index, ids, hash cache, exclusion rules.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildPresentationManifest, writePresentationManifest } = require('../lib/presentationManifest');
const { tmpDir } = require('./helpers/paths');

function fixture() {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, '_media'));
  fs.mkdirSync(path.join(dir, '_resources', '_media'), { recursive: true });
  fs.mkdirSync(path.join(dir, '_resources', 'other'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.thumbs'));
  fs.writeFileSync(path.join(dir, 'presentation.md'), '# hello');
  fs.writeFileSync(path.join(dir, '_media', 'a.png'), 'png');
  fs.writeFileSync(path.join(dir, '_resources', '_media', 'r.png'), 'r');
  fs.writeFileSync(path.join(dir, '_resources', 'other', 'x.txt'), 'x');
  fs.writeFileSync(path.join(dir, '.thumbs', 't.png'), 't');
  fs.writeFileSync(path.join(dir, '__builder_temp.md'), 'tmp');
  return dir;
}

test('manifest lists the right files with correct sha1/size and no self hash', async () => {
  const dir = fixture();
  const m = await buildPresentationManifest(dir, { title: 'T' });
  const byName = Object.fromEntries(m.files.map((e) => [e.filename, e]));
  assert.deepStrictEqual(Object.keys(byName).sort(), ['_media/a.png', '_resources/_media/r.png', 'manifest.json', 'presentation.md']);
  assert.strictEqual(byName['presentation.md'].sha1, crypto.createHash('sha1').update('# hello').digest('hex'));
  assert.strictEqual(byName['presentation.md'].size, 7);
  assert.strictEqual(byName['manifest.json'].sha1, undefined);
  assert.strictEqual(m.title, 'T');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('presentationId is a UUID, persisted across rewrites, and a valid supplied id wins', async () => {
  const dir = fixture();
  const first = await writePresentationManifest(dir, {});
  assert.match(first.presentationId, /^[0-9a-f-]{36}$/);
  const second = await writePresentationManifest(dir, {});
  assert.strictEqual(second.presentationId, first.presentationId);
  const supplied = '12345678-1234-1234-1234-123456789abc';
  assert.strictEqual((await buildPresentationManifest(dir, { presentationId: supplied.toUpperCase() })).presentationId, supplied);
  const bogus = await buildPresentationManifest(dir, { presentationId: '../../etc' });
  assert.strictEqual(bogus.presentationId, first.presentationId, 'invalid id falls back to the stored one');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('exclude and overrides shape the listing', async () => {
  const dir = fixture();
  const override = Buffer.from('sanitized');
  const m = await buildPresentationManifest(dir, {}, {
    exclude: (rel) => rel === '_media/a.png',
    overrides: new Map([['presentation.md', override]])
  });
  assert.ok(!m.files.find((e) => e.filename === '_media/a.png'));
  const pres = m.files.find((e) => e.filename === 'presentation.md');
  assert.strictEqual(pres.size, override.length);
  assert.strictEqual(pres.sha1, crypto.createHash('sha1').update(override).digest('hex'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('unchanged files reuse the cached hash; forceRecompute ignores the cache', async () => {
  const dir = fixture();
  await writePresentationManifest(dir, {});
  const manifestPath = path.join(dir, 'manifest.json');
  const stored = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  stored.files.find((e) => e.filename === 'presentation.md').sha1 = 'cached-marker';
  fs.writeFileSync(manifestPath, JSON.stringify(stored));
  const cached = await buildPresentationManifest(dir, {});
  assert.strictEqual(cached.files.find((e) => e.filename === 'presentation.md').sha1, 'cached-marker');
  const fresh = await buildPresentationManifest(dir, {}, { forceRecompute: true });
  assert.notStrictEqual(fresh.files.find((e) => e.filename === 'presentation.md').sha1, 'cached-marker');
  fs.rmSync(dir, { recursive: true, force: true });
});
