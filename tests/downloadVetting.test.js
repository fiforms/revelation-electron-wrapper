// Downloaded content gets the same rules as a .revel entry, whether it comes
// from URL import (streamed) or missing-media recovery (temp file). Plus revelFormat's longer prohibited list.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { installElectronStub, electronStub } = require('./helpers/electron-stub');
const { tmpDir } = require('./helpers/paths');

installElectronStub();

const revelFormat = require('../lib/revelFormat');
const { importPresentation, importMissingMediaFromYaml } = require('../lib/importPresentation');

const quiet = { log() {}, warn() {}, error() {} };
const silence = async (fn) => {
  const original = [console.warn, console.log];
  console.warn = () => {}; console.log = () => {};
  try { return await fn(); } finally { [console.warn, console.log] = original; }
};

const SCRIPTED_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1" onclick="x()"/></svg>';
const MZ = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(32, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 3)]);

// ---- revelFormat ---------------------------------------------------------------------------------
test('prohibited list now covers more script/installer types, including compressed SVG', () => {
  for (const name of ['a.hta', 'a.jse', 'a.vbe', 'a.wsh', 'a.reg', 'a.scf', 'a.url', 'a.pif', 'a.msc', 'a.swf',
    'a.svgz', 'a.xsl', 'a.xslt', 'a.appimage', 'a.pkg', 'a.deb', 'a.rpm', 'a.apk', 'A.HTA', 'a.hta.', 'a.png.url']) {
    assert.ok(revelFormat.isProhibitedName(name), name);
  }
  for (const name of ['a.png', 'a.svg', 'a.mp4', 'deck.pdf', 'notes.docx', 'a.json', 'font.woff2']) {
    assert.ok(!revelFormat.isProhibitedName(name), name);
  }
});

test('finalExtension sees through trailing dots and spaces', () => {
  assert.strictEqual(revelFormat.finalExtension('x.svg.'), '.svg');
  assert.strictEqual(revelFormat.finalExtension('x.SVG '), '.svg');
  assert.strictEqual(revelFormat.finalExtension('dir/x.tar.gz'), '.gz');
});

test('vetFileOnDisk applies the .revel content rules to a file on disk', () => {
  const dir = tmpDir();
  const write = (name, content) => { const p = path.join(dir, name); fs.writeFileSync(p, content); return p; };

  assert.deepStrictEqual(revelFormat.vetFileOnDisk(write('ok.png', PNG), 'ok.png'), { ok: true, cleaned: false });
  assert.match(revelFormat.vetFileOnDisk(write('a.bin', MZ), 'photo.png').reason, /executable/);
  assert.match(revelFormat.vetFileOnDisk(write('b.bin', Buffer.from('#!/bin/sh\n')), 'noext').reason, /executable/);
  assert.match(revelFormat.vetFileOnDisk(write('c.bin', Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])), 'movie.mp4').reason, /archive/);
  assert.match(revelFormat.vetFileOnDisk(write('d.bin', 'x'), 'page.html').reason, /not allowed/);

  for (const name of ['pic.svg', 'pic.svg.', 'PIC.SVG ']) {
    const file = write(`${name.trim()}.tmp`, SCRIPTED_SVG);
    const result = revelFormat.vetFileOnDisk(file, name);
    assert.deepStrictEqual(result, { ok: true, cleaned: true }, name);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/script|onclick/i.test(text), `${name}: ${text}`);
    assert.ok(text.includes('<rect'), 'harmless content survives');
  }
  assert.strictEqual(revelFormat.vetFileOnDisk(write('e.tmp', 'not xml at all'), 'bad.svg').ok, false);
  assert.strictEqual(revelFormat.vetFileOnDisk(write('f.tmp', Buffer.alloc(revelFormat.MAX_SVG_BYTES + 1, 0x20)), 'huge.svg').ok, false);
});

// ---- URL import end to end -----------------------------------------------------------------------
function deckServer(files, { manifestOverride } = {}) {
  const entries = Object.entries(files);
  const manifest = manifestOverride || {
    files: [
      'manifest.json',
      ...entries.map(([name, entry]) => ({
        filename: name,
        size: entry.size ?? entry.data.length,
        sha1: entry.sha1 ?? crypto.createHash('sha1').update(entry.data).digest('hex')
      }))
    ]
  };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/deck\//, '');
    if (rel === 'manifest.json') { res.writeHead(200); return res.end(JSON.stringify(manifest)); }
    const entry = files[rel];
    if (!entry) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-length': entry.data.length });
    return res.end(entry.data);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}/deck/index.html`,
    close: () => { server.closeAllConnections?.(); server.close(); }
  })));
}
const file = (data) => ({ data: Buffer.isBuffer(data) ? data : Buffer.from(data) });

async function urlImport(files, { answer = 1, slug = 'imported', manifestOverride } = {}) {
  const presentationsDir = tmpDir();
  const deck = await deckServer(files, { manifestOverride });
  let asked = 0;
  electronStub.dialog.showMessageBox = async () => { asked += 1; return { response: answer }; };
  try {
    const result = await silence(() => importPresentation.runUrlImport(
      { url: deck.url, slug },
      { ...quiet, config: { presentationsDir }, callbacks: {}, translate: (s) => s }
    ));
    return { result, dest: path.join(presentationsDir, slug), asked, presentationsDir };
  } finally {
    deck.close();
  }
}

test('URL import streams files to disk and applies name, signature and SVG rules', async () => {
  const { result, dest, asked } = await urlImport({
    'presentation.md': file('# hello'),
    '_media/ok.png': file(PNG),
    'evil.svg': file(SCRIPTED_SVG),
    'trick.svg.': file(SCRIPTED_SVG), // Windows would store this as trick.svg
    'run.exe': file(MZ),
    'page.html': file('<script>alert(1)</script>'),
    'disguised.png': file(MZ),
    'notsvg.svg': file('plain text')
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(asked, 0, 'nothing failed validation');
  assert.strictEqual(fs.readFileSync(path.join(dest, 'presentation.md'), 'utf8'), '# hello');
  assert.ok(fs.readFileSync(path.join(dest, '_media', 'ok.png')).equals(PNG));
  for (const name of ['evil.svg', 'trick.svg.']) {
    const text = fs.readFileSync(path.join(dest, name), 'utf8');
    assert.ok(!/script|onclick/i.test(text), `${name} was not sanitized: ${text}`);
  }
  for (const name of ['run.exe', 'page.html', 'disguised.png', 'notsvg.svg']) {
    assert.strictEqual(fs.existsSync(path.join(dest, name)), false, `${name} should have been skipped`);
  }
  assert.deepStrictEqual([...result.skipped].sort(), ['disguised.png', 'notsvg.svg', 'page.html', 'run.exe']);
  assert.deepStrictEqual(fs.readdirSync(dest).filter((n) => n.includes('.part-')), [], 'no temp files left behind');
});

test('URL import checks size and sha1 against the manifest while streaming', async () => {
  const wrong = { data: Buffer.from('abc'), sha1: '0'.repeat(40) };

  const cancelled = await urlImport({ 'presentation.md': file('# hi'), 'wrong.bin': wrong }, { answer: 0, slug: 'a' });
  assert.strictEqual(cancelled.asked, 1);
  assert.strictEqual(cancelled.result.success, false);
  assert.strictEqual(fs.existsSync(cancelled.dest), false, 'cancelled import leaves nothing');

  const accepted = await urlImport({ 'presentation.md': file('# hi'), 'wrong.bin': wrong }, { answer: 1, slug: 'b' });
  assert.strictEqual(accepted.result.success, true);
  assert.strictEqual(accepted.result.validation.passed, false);
  assert.strictEqual(accepted.result.validation.errors[0].filename, 'wrong.bin');
  assert.match(accepted.result.validation.errors[0].issue, /SHA1/);

  const sized = await urlImport({ 'presentation.md': file('# hi'), 'size.bin': { data: Buffer.from('abcd'), size: 99 } }, { answer: 1, slug: 'c' });
  assert.match(sized.result.validation.errors[0].issue, /Size mismatch: expected 99 B, got 4 B/);
});

test('URL import cannot be steered outside the presentation folder by manifest names', async () => {
  const presentationsDir = tmpDir();
  const deck = await deckServer({ 'presentation.md': file('# hi') }, {
    manifestOverride: { files: ['presentation.md', '../escape.txt'] }
  });
  try {
    await assert.rejects(
      silence(() => importPresentation.runUrlImport({ url: deck.url, slug: 'x' }, { ...quiet, config: { presentationsDir }, callbacks: {} })),
      /invalid/i
    );
  } finally {
    deck.close();
  }
  assert.deepStrictEqual(fs.readdirSync(presentationsDir), []);
  assert.strictEqual(fs.existsSync(path.join(presentationsDir, '..', 'escape.txt')), false);
});

// ---- missing-media recovery ----------------------------------------------------------------------
function fakeHttps(bodyFor) {
  const https = require('https');
  const { PassThrough } = require('stream');
  const original = https.get;
  https.get = (url, onResponse) => {
    const res = new PassThrough();
    res.statusCode = 200;
    res.headers = { 'content-type': 'application/octet-stream' };
    res.complete = true;
    setImmediate(() => { onResponse(res); res.end(bodyFor(String(url))); });
    return { on() { return this; }, setTimeout() {}, destroy() {} };
  };
  return () => { https.get = original; };
}

test('missing-media downloads are vetted before entering the shared library', async () => {
  const presentationsDir = tmpDir();
  fs.mkdirSync(path.join(presentationsDir, '_media'));
  const folder = path.join(presentationsDir, 'imported');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'presentation.md'), [
    '---',
    'media:',
    '  good:   { filename: good.png,   url_direct: "https://example.invalid/good.png" }',
    '  fake:   { filename: fake.png,   url_direct: "https://example.invalid/fake.png" }',
    '  vector: { filename: vector.svg, url_direct: "https://example.invalid/vector.svg" }',
    '  bad:    { filename: bad.svg,    url_direct: "https://example.invalid/bad.svg" }',
    '---'
  ].join('\n'));

  // Test files run in parallel and share os.tmpdir() (importMedia.test.js also leaves revelation-dl-*
  // files there while it runs), so only look at the temp names this test's own downloads produce.
  const ownNames = ['good.png', 'fake.png', 'vector.svg', 'bad.svg'];
  const downloads = () => fs.readdirSync(require('os').tmpdir())
    .filter((n) => n.startsWith('revelation-dl-') && ownNames.some((f) => n.endsWith(`-${f}`)));
  const before = new Set(downloads());
  electronStub.dialog.showMessageBox = async () => ({ response: 0 });
  const restore = fakeHttps((url) => {
    if (url.endsWith('good.png')) return PNG;
    if (url.endsWith('fake.png')) return MZ; // executable disguised as an image
    if (url.endsWith('vector.svg')) return SCRIPTED_SVG;
    return 'this is not an svg';
  });
  try {
    await silence(() => importMissingMediaFromYaml(folder, { ...quiet, config: { presentationsDir }, callbacks: {} }));
  } finally {
    restore();
  }

  const media = path.join(presentationsDir, '_media');
  assert.ok(fs.existsSync(path.join(media, 'good.png')), 'a good file is imported');
  assert.strictEqual(fs.existsSync(path.join(media, 'fake.png')), false, 'disguised executable rejected');
  assert.strictEqual(fs.existsSync(path.join(media, 'bad.svg')), false, 'non-SVG under .svg rejected');
  const svg = fs.readFileSync(path.join(media, 'vector.svg'), 'utf8');
  assert.ok(!/script|onclick/i.test(svg), `SVG sanitized on the way in: ${svg}`);
  assert.deepStrictEqual(downloads().filter((n) => !before.has(n)), [], 'temp downloads are cleaned up');
});
