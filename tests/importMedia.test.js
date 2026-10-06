// Media filenames from imported front matter, sidecars, export input and
// renderer IPC must never reach outside the shared `_media` folder. Each test plants a "victim" file
// outside `_media` and checks it survives and nothing new appears next to it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { installElectronStub, electronStub } = require('./helpers/electron-stub');
const { tmpDir } = require('./helpers/paths');

installElectronStub();

const { importMediaFromResources, importMissingMediaFromYaml } = require('../lib/importPresentation');
const { collectReferencedMediaFilenames, copyMediaForExport } = require('../lib/exportPresentation');
const { mediaLibrary } = require('../lib/mediaLibrary');

const quiet = { log() {}, warn() {}, error() {} };
const silence = async (fn) => {
  const original = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = original; }
};

// presentationsDir/{_media, victim.txt, imported/}; AppContext pointing at it.
function library() {
  const presentationsDir = tmpDir();
  fs.mkdirSync(path.join(presentationsDir, '_media'));
  fs.writeFileSync(path.join(presentationsDir, 'victim.txt'), 'untouched');
  fs.mkdirSync(path.join(presentationsDir, 'imported'));
  return { presentationsDir, AppContext: { ...quiet, config: { presentationsDir }, callbacks: {}, translate: (s) => s } };
}
const stillIntact = (dir) => assert.strictEqual(fs.readFileSync(path.join(dir, 'victim.txt'), 'utf8'), 'untouched');
const topLevel = (dir) => fs.readdirSync(dir).sort();

test('import from _resources/_media copies good items and skips unsafe sidecar filenames', async () => {
  const { presentationsDir, AppContext } = library();
  const res = path.join(presentationsDir, 'imported', '_resources', '_media');
  fs.mkdirSync(res, { recursive: true });
  const item = (name, extra = {}) => {
    fs.writeFileSync(path.join(res, name), 'bytes');
    fs.writeFileSync(path.join(res, `${name}.json`), JSON.stringify({ filename: name, ...extra }));
  };
  item('good.png');
  fs.writeFileSync(path.join(res, 'evil.png.json'), JSON.stringify({ filename: '../../victim.txt' }));
  fs.writeFileSync(path.join(res, 'badvariant.png.json'), JSON.stringify({ filename: 'badvariant.png', large_variant: { filename: '../victim.txt' } }));
  fs.writeFileSync(path.join(res, 'badvariant.png'), 'bytes');
  fs.writeFileSync(path.join(res, 'script.html.json'), JSON.stringify({ filename: 'script.html' }));
  fs.writeFileSync(path.join(res, 'script.html'), '<script>');

  await silence(() => importMediaFromResources(path.join(presentationsDir, 'imported'), AppContext));

  const media = path.join(presentationsDir, '_media');
  assert.deepStrictEqual(fs.readdirSync(media).sort(), ['good.png', 'good.png.json']);
  stillIntact(presentationsDir);
});

test('missing-media recovery ignores unsafe filenames and never queues a download for them', async () => {
  const { presentationsDir, AppContext } = library();
  const folder = path.join(presentationsDir, 'imported');
  fs.writeFileSync(path.join(folder, 'presentation.md'), [
    '---',
    'title: x',
    'media:',
    '  up:      { filename: ../../pwn.png,   url_direct: "https://example.invalid/a.png" }',
    '  abs:     { filename: /tmp/pwn.png,    url_direct: "https://example.invalid/b.png" }',
    '  html:    { filename: page.html,       url_direct: "https://example.invalid/c.html" }',
    '---',
    '# slide'
  ].join('\n'));

  let prompted = false;
  electronStub.dialog.showMessageBox = async () => { prompted = true; return { response: 1 }; };

  const result = await silence(() => importMissingMediaFromYaml(folder, AppContext));

  assert.strictEqual(result.missingCount, 0, 'nothing unsafe may be queued');
  assert.strictEqual(prompted, false, 'no download prompt for entries that were all rejected');
  assert.deepStrictEqual(topLevel(presentationsDir), ['_media', 'imported', 'victim.txt']);
  assert.deepStrictEqual(fs.readdirSync(path.join(presentationsDir, '_media')), []);
});

// Serves `https.get` from memory so the download path runs end to end without a network.
function fakeHttps() {
  const https = require('https');
  const { PassThrough } = require('stream');
  const original = https.get;
  const requested = [];
  https.get = (url, onResponse) => {
    requested.push(String(url));
    const res = new PassThrough();
    res.statusCode = 200;
    res.headers = { 'content-type': 'image/png' };
    res.complete = true; // real IncomingMessages set this once the whole body has arrived
    setImmediate(() => { onResponse(res); res.end('PAYLOAD'); });
    return { on() { return this; }, setTimeout() {}, destroy() {} };
  };
  return { requested, restore: () => { https.get = original; } };
}

test('after the user agrees to download, an unsafe large-variant name is not written outside _media', async () => {
  const { presentationsDir, AppContext } = library();
  const folder = path.join(presentationsDir, 'imported');
  fs.writeFileSync(path.join(folder, 'presentation.md'), [
    '---',
    'media:',
    '  ok:',
    '    filename: ok.png',
    '    url_direct: "https://example.invalid/ok.png"',
    '    large_variant: { filename: ../planted-by-import.txt, url_direct: "https://example.invalid/big" }',
    '  up: { filename: ../planted-too.png, url_direct: "https://example.invalid/up.png" }',
    '---'
  ].join('\n'));

  electronStub.dialog.showMessageBox = async () => ({ response: 0 }); // Download
  const net = fakeHttps();
  let result;
  try {
    result = await silence(() => importMissingMediaFromYaml(folder, AppContext));
  } finally {
    net.restore();
  }

  assert.strictEqual(result.missingCount, 1, 'only the safe entry is queued');
  assert.ok(net.requested.every((url) => !/big|up\.png/.test(url)), `unexpected downloads: ${net.requested}`);
  assert.ok(fs.existsSync(path.join(presentationsDir, '_media', 'ok.png')), 'the safe file is still imported');
  assert.deepStrictEqual(topLevel(presentationsDir), ['_media', 'imported', 'victim.txt'], 'nothing created outside _media');
  stillIntact(presentationsDir);
});

test('export media list drops unsafe names and tolerates null media entries', () => {
  const list = collectReferencedMediaFilenames([
    {
      media: {
        a: { filename: 'a.png', large_variant: { filename: 'a.big.webm' } },
        b: { filename: '../../victim.txt' },
        c: { filename: 'x/y.png' },
        d: null,
        e: 'text',
        f: { filename: 'page.html' }
      }
    },
    {},
    null,
    { media: 'nope' }
  ]);
  assert.deepStrictEqual([...list].sort(), ['a.big.webm', 'a.png']);
});

test('export copies only library files (and their sidecars) for the safe names', () => {
  const root = tmpDir();
  const src = path.join(root, '_media');
  const dest = path.join(root, 'out', '_media');
  fs.mkdirSync(src);
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.png'), 'a');
  fs.writeFileSync(path.join(src, 'a.png.json'), '{}');
  fs.writeFileSync(path.join(src, 'a.png.thumbnail.jpg'), 't');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'secret');

  const names = collectReferencedMediaFilenames([{ media: { a: { filename: 'a.png' }, s: { filename: '../secret.txt' } } }]);
  copyMediaForExport(names, src, dest);

  assert.deepStrictEqual(fs.readdirSync(dest).sort(), ['a.png', 'a.png.json', 'a.png.thumbnail.jpg']);
  assert.strictEqual(fs.existsSync(path.join(root, 'out', 'secret.txt')), false);
});

// --- media library IPC (renderer-supplied filenames) --------------------------------------------
function registerLibrary(AppContext) {
  const handlers = {};
  mediaLibrary.register({ handle: (channel, fn) => { handlers[channel] = fn; }, on() {}, once() {} }, AppContext);
  return handlers;
}

test('delete-media-item removes the item and its sidecars but refuses names outside _media', async () => {
  const { presentationsDir, AppContext } = library();
  const media = path.join(presentationsDir, '_media');
  for (const f of ['a.png', 'a.png.json', 'a.png.thumbnail.jpg']) fs.writeFileSync(path.join(media, f), 'x');
  const handlers = registerLibrary(AppContext);

  for (const bad of ['../victim.txt', '..', 'sub/a.png', path.join(presentationsDir, 'victim.txt')]) {
    const result = await handlers['delete-media-item']({}, bad);
    assert.strictEqual(result.success, false, bad);
  }
  stillIntact(presentationsDir);
  assert.ok(fs.existsSync(path.join(media, 'a.png')));

  assert.deepStrictEqual(await handlers['delete-media-item']({}, 'a.png'), { success: true });
  assert.deepStrictEqual(fs.readdirSync(media), []);
});

test('large-variant operations refuse a variant filename planted in a sidecar', async () => {
  const { presentationsDir, AppContext } = library();
  const media = path.join(presentationsDir, '_media');
  fs.writeFileSync(path.join(media, 'a.png'), 'x');
  fs.writeFileSync(path.join(media, 'a.png.json'), JSON.stringify({
    filename: 'a.png',
    large_variant: { filename: '../victim.txt', url_direct: 'https://example.invalid/big.webm' }
  }));
  const handlers = registerLibrary(AppContext);

  for (const channel of ['delete-large-variant', 'convert-large-variant', 'download-large-variant']) {
    const result = await handlers[channel]({}, 'a.png');
    assert.strictEqual(result.success, false, channel);
    assert.match(result.error, /Unsafe/, channel);
  }
  stillIntact(presentationsDir);

  for (const channel of ['delete-large-variant', 'convert-large-variant', 'download-large-variant']) {
    const result = await handlers[channel]({}, '../victim.txt');
    assert.strictEqual(result.success, false, channel);
  }
  stillIntact(presentationsDir);
});
