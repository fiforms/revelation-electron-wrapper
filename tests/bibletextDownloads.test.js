// plugins/bibletext Bible downloads: the USFM converter (usfm.js), the downloader (bibleDownloader.js) against a
// loopback server (manifest + hashes, hostile names, the NET zip), loading from two folders (localbiblemanager.js)
// and the first-run state (lib/firstRunBibles.js). No network; nothing here opens a window.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const { installElectronStub } = require('./helpers/electron-stub');

installElectronStub();

// localbiblemanager.js logs emoji progress lines. Left on, they intermittently trip the node:test runner's stdout
// parsing ("Unable to deserialize cloned data"), so keep them out of this test process.
console.log = () => {};

const { BOOKS, bookForUsfm, parseUsfmBook, buildZefaniaXml } = require('../plugins/bibletext/usfm');
const downloader = require('../plugins/bibletext/bibleDownloader');
const localBibles = require('../plugins/bibletext/localbiblemanager');
const firstRunBibles = require('../lib/firstRunBibles');

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), `revelation-${prefix}-`));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- usfm.js

test('parseUsfmBook keeps the words of plain eBible USFM and drops notes and headings', () => {
  const usfm = [
    '\\id GEN  ', '\\h Genesis', '\\mt1 Genesis', '\\c 1', '\\s1 The Creation',
    '\\p', '\\v 1  \\w In|strong="H8064"\\w* \\w the|strong="H1254"\\w* beginning \\f + \\fr 1:1 \\ft A note.\\f*God created.',
    '\\v 2  \\nd \\+w Lord|strong="H3068"\\+w*\\nd* said, “\\qt  Let there be light\\qt**.”',
    '\\c 2', '\\q1', '\\v 1 Done.'
  ].join('\n');
  const { chapters } = parseUsfmBook(usfm, 'Genesis');
  assert.deepStrictEqual(chapters, [
    ['In the beginning God created.', 'LORD said, “Let there be light.”'],
    ['Done.']
  ]);
});

test('parseUsfmBook handles word-aligned unfoldingWord USFM', () => {
  const usfm = [
    '\\id GEN EN_ULT', '\\c 1', '\\p',
    '\\v 1 \\zaln-s |x-strong="b:H7225" x-lemma="x" x-occurrence="1" x-occurrences="1" x-content="y"\\*\\w In|x-occurrence="1" x-occurrences="1"\\w*',
    '\\w the|x-occurrence="1" x-occurrences="3"\\w*\\zaln-e\\*',
    '\\zaln-s |x-strong="H0430"\\*\\w God|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*.'
  ].join('\n');
  assert.deepStrictEqual(parseUsfmBook(usfm, 'Genesis').chapters, [['In the God.']]);
});

test('a psalm title is folded into verse 1, with a period when it has none', () => {
  const usfm = '\\id PSA\n\\c 1\n\\d A psalm of David\n\\q1 \\v 1 Lord, how many foes.\n\\c 2\n\\d For the choir.\n\\q1 \\v 1 Answer me.';
  assert.deepStrictEqual(parseUsfmBook(usfm, 'Psalms').chapters, [
    ['A psalm of David. Lord, how many foes.'],
    ['For the choir. Answer me.']
  ]);
});

test('verse ranges and missing verses keep later verses in position', () => {
  const usfm = '\\id MAT\n\\c 1\n\\v 1 One.\n\\v 2-3 Two and three.\n\\v 5 Five.';
  const { chapters, notes } = parseUsfmBook(usfm, 'Matthew');
  assert.deepStrictEqual(chapters, [['One.', 'Two and three.', '', '', 'Five.']]);
  assert.ok(notes.some((n) => /verse range/.test(n)));
  assert.ok(notes.some((n) => /1:4: verse missing/.test(n)));
});

test('a chapter or verse out of sequence is refused', () => {
  assert.throws(() => parseUsfmBook('\\id GEN\n\\c 1\n\\v 1 a\n\\c 3\n\\v 1 b', 'Genesis'), /chapter 3 out of sequence/);
  assert.throws(() => parseUsfmBook('\\id GEN\n\\c 1\n\\v 2 a\n\\v 1 b', 'Genesis'), /verse out of sequence/);
  assert.throws(() => parseUsfmBook('\\id GEN\n\\v 1 a', 'Genesis'), /no chapters/);
});

test('quote spacing left by markers is tidied and a stray asterisk is dropped', () => {
  const usfm = '\\id MAT\n\\c 1\n\\v 1 He said, ‘\\qt  Man lives\\qt* \\qt  by bread\\qt*’ and ” left *.';
  assert.deepStrictEqual(parseUsfmBook(usfm, 'Matthew').chapters, [['He said, ‘Man lives by bread’ and” left.']]);
});

test('bookForUsfm reads the \\id line, ignoring front matter and unknown codes', () => {
  assert.strictEqual(bookForUsfm('﻿\\id JHN  \n\\h John').name, 'John');
  assert.strictEqual(bookForUsfm('\\id PSA').name, 'Psalms');
  assert.strictEqual(bookForUsfm('\\id FRT'), null);
  assert.strictEqual(BOOKS.length, 66);
  assert.strictEqual(BOOKS[39].name, 'Matthew');
});

test('buildZefaniaXml output loads through localbiblemanager', async () => {
  const dir = tmp('zef');
  const xml = buildZefaniaXml({
    title: 'Test <Bible>', creator: 'c', description: 'd', publisher: 'p', date: '2026-01-01',
    identifier: 'tst', source: 's', language: 'ENG', rights: 'r & r'
  }, [{ num: 1, name: 'Genesis', chapters: [['In the beginning.', 'Then "light".']] }]);
  assert.strictEqual(xml.verseCount, 2);
  fs.writeFileSync(path.join(dir, 'T.xml'), xml.xml);
  await localBibles.loadBibles(dir);
  assert.strictEqual(localBibles.biblelist.length, 1);
  const bible = JSON.parse(fs.readFileSync(path.join(dir, 'T.json'), 'utf8'));
  assert.strictEqual(bible.name, 'Test <Bible>');
  assert.strictEqual(bible.info.identifier, 'tst');
  assert.deepStrictEqual(bible.books[0].chapters, [['In the beginning.', 'Then "light".']]);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------- loadBibles, two folders

test('loadBibles reads several folders, skips a missing one and lets the first duplicate id win', async () => {
  const bundled = tmp('bundled');
  const user = tmp('user');
  const make = (id, text) => buildZefaniaXml({
    title: id, creator: '', description: '', publisher: '', date: '2026-01-01', identifier: id, source: '', language: 'ENG', rights: ''
  }, [{ num: 1, name: 'Genesis', chapters: [[text]] }]).xml;
  fs.writeFileSync(path.join(bundled, 'KJV.xml'), make('kjv', 'bundled kjv'));
  fs.writeFileSync(path.join(user, 'NET.xml'), make('net', 'net text'));
  fs.writeFileSync(path.join(user, 'KJV2.xml'), make('kjv', 'duplicate kjv'));
  await localBibles.loadBibles([bundled, path.join(user, 'does-not-exist'), user], { cacheDir: user });
  const ids = localBibles.biblelist.map((b) => b.info.identifier).sort();
  assert.deepStrictEqual(ids, ['kjv', 'net']);
  const kjv = JSON.parse(fs.readFileSync(localBibles.biblelist.find((b) => b.info.identifier === 'kjv').path, 'utf8'));
  assert.strictEqual(kjv.books[0].chapters[0][0], 'bundled kjv');
  fs.rmSync(bundled, { recursive: true, force: true });
  fs.rmSync(user, { recursive: true, force: true });
});

test('loadBibles puts the cache in cacheDir when the Bible folder is read-only', async (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return t.skip('root can write anywhere');
  if (process.platform === 'win32') return t.skip('POSIX permissions');
  const bundled = tmp('ro');
  const cache = tmp('cache');
  fs.writeFileSync(path.join(bundled, 'K.xml'), buildZefaniaXml({
    title: 'k', creator: '', description: '', publisher: '', date: '2026-01-01', identifier: 'k', source: '', language: 'ENG', rights: ''
  }, [{ num: 1, name: 'Genesis', chapters: [['x']] }]).xml);
  fs.chmodSync(bundled, 0o555);
  try {
    await localBibles.loadBibles(bundled, { cacheDir: cache });
    assert.strictEqual(localBibles.biblelist.length, 1);
    assert.ok(fs.existsSync(path.join(cache, 'K.json')), 'cache written to cacheDir');
    assert.ok(!fs.existsSync(path.join(bundled, 'K.json')), 'nothing written to the read-only folder');
  } finally {
    fs.chmodSync(bundled, 0o755);
    fs.rmSync(bundled, { recursive: true, force: true });
    fs.rmSync(cache, { recursive: true, force: true });
  }
});

// ------------------------------------------------------- bibleDownloader

let server;
let base;
const files = new Map(); // url path -> Buffer
let manifestBody = '{}';

test.before(async () => {
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/manifest.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(manifestBody);
    }
    if (files.has(p)) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(files.get(p));
    }
    res.writeHead(404);
    res.end('missing');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('installCollection downloads, verifies hashes, skips bundled and unsafe entries, and is repeatable', async () => {
  const good = Buffer.from('<bible><b n="Genesis"><c n="1"><v n="1">x</v></c></b></bible>');
  const bad = Buffer.from('tampered');
  const bundled = Buffer.from('bundled');
  files.set('/Good One (NIV).xml', good);
  files.set('/Bad.xml', bad);
  files.set('/KJV.xml', bundled);
  manifestBody = JSON.stringify({
    files: [
      { name: 'Good One (NIV).xml', sha256: sha256(good) },
      { name: 'Bad.xml', sha256: sha256(Buffer.from('what the manifest promised')) },
      { name: 'KJV.xml', sha256: sha256(bundled) },
      { name: '../escape.xml', sha256: sha256(good) },
      { name: 'notes.txt', sha256: sha256(good) }
    ]
  });
  const dest = tmp('collection');
  const progress = [];
  const result = await downloader.installCollection({
    destDir: dest, manifestUrl: `${base}/manifest.json`, skipNames: ['kjv'], httpsOnly: false,
    onProgress: (p) => progress.push(p)
  });
  assert.deepStrictEqual(result.downloaded, ['Good One (NIV).xml']);
  assert.deepStrictEqual(result.skipped, ['KJV.xml']);
  assert.deepStrictEqual(result.failed.map((f) => f.name).sort(), ['../escape.xml', 'Bad.xml', 'notes.txt']);
  assert.match(result.failed.find((f) => f.name === 'Bad.xml').error, /hash mismatch/);
  assert.deepStrictEqual(fs.readdirSync(dest).sort(), ['Good One (NIV).xml'], 'no .part leftovers, nothing outside destDir, no marker after failures');
  assert.ok(!fs.existsSync(path.join(path.dirname(dest), 'escape.xml')));
  assert.strictEqual(progress.at(-1).received, 5);

  // Again with only the good entry: now up to date, and the marker is written.
  manifestBody = JSON.stringify({ files: [{ name: 'Good One (NIV).xml', sha256: sha256(good) }] });
  const again = await downloader.installCollection({ destDir: dest, manifestUrl: `${base}/manifest.json`, httpsOnly: false });
  assert.deepStrictEqual(again.upToDate, ['Good One (NIV).xml']);
  assert.strictEqual(downloader.getStatus(dest).collection.installed, true);
  fs.rmSync(dest, { recursive: true, force: true });
});

test('installCollection refuses https-only downgrade and an empty manifest', async () => {
  const dest = tmp('collection-bad');
  await assert.rejects(downloader.installCollection({ destDir: dest, manifestUrl: `${base}/manifest.json` }), /https/i);
  manifestBody = JSON.stringify({ files: [] });
  await assert.rejects(downloader.installCollection({ destDir: dest, manifestUrl: `${base}/manifest.json`, httpsOnly: false }), /lists no files/);
  fs.rmSync(dest, { recursive: true, force: true });
});

function zipBuffer(entries) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip');
    const chunks = [];
    archive.on('data', (c) => chunks.push(c));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    for (const [name, content] of Object.entries(entries)) archive.append(content, { name });
    archive.finalize();
  });
}

const tinyUsfm = (code, i) => `\\id ${code}\n\\h X\n\\c 1\n\\p\n\\v 1 \\w Verse|strong="H1"\\w* of book ${i}.\n\\v 2 Second.`;

test('installNet converts the USFM zip to NET.xml and the app can load it', async () => {
  const entries = { 'copr.htm': '<html></html>', 'sub/ignored.usfm': tinyUsfm('GEN', 0) };
  BOOKS.forEach((b, i) => { entries[`${String(i + 2).padStart(2, '0')}-${b.code}engnet.usfm`] = tinyUsfm(b.code, i); });
  entries['A0-FRTengnet.usfm'] = '\\id FRT\n\\h Front';
  files.set('/engnet_usfm.zip', await zipBuffer(entries));

  const dest = tmp('net');
  const phases = [];
  const result = await downloader.installNet({
    destDir: dest, url: `${base}/engnet_usfm.zip`, httpsOnly: false, minVerses: 132, onProgress: (p) => phases.push(p.phase)
  });
  assert.strictEqual(result.verseCount, 132);
  assert.ok(phases.includes('downloading') && phases.includes('converting'));
  assert.deepStrictEqual(fs.readdirSync(dest), ['NET.xml']);
  assert.strictEqual(downloader.getStatus(dest).net.installed, true);

  await localBibles.loadBibles(dest);
  const net = JSON.parse(fs.readFileSync(localBibles.biblelist[0].path, 'utf8'));
  assert.strictEqual(net.info.identifier, 'net');
  assert.match(net.info.rights, /\(NET\)/);
  assert.strictEqual(net.books.length, 66);
  assert.strictEqual(net.books[0].chapters[0][0], 'Verse of book 0.');
  assert.strictEqual(net.books[65].name, 'Revelation');
  fs.rmSync(dest, { recursive: true, force: true });
});

test('installNet rejects an incomplete or wrong download and writes nothing', async () => {
  const dest = tmp('net-bad');
  files.set('/short.zip', await zipBuffer({ '02-GENengnet.usfm': tinyUsfm('GEN', 0) }));
  await assert.rejects(downloader.installNet({ destDir: dest, url: `${base}/short.zip`, httpsOnly: false }), /1 of 66 books/);
  files.set('/notzip.zip', Buffer.from('<html>not a zip</html>'));
  await assert.rejects(downloader.installNet({ destDir: dest, url: `${base}/notzip.zip`, httpsOnly: false }));
  files.set('/empty.zip', await zipBuffer({ 'readme.txt': 'hi' }));
  await assert.rejects(downloader.installNet({ destDir: dest, url: `${base}/empty.zip`, httpsOnly: false }), /not the expected USFM zip/);
  assert.deepStrictEqual(fs.readdirSync(dest), []);
  fs.rmSync(dest, { recursive: true, force: true });
});

test('install() runs one download at a time and reports failures', async () => {
  const dest = tmp('lock');
  manifestBody = JSON.stringify({ files: [{ name: 'Slow.xml' }] });
  files.set('/Slow.xml', Buffer.from('<bible/>'));
  const opts = { destDir: dest, manifestUrl: `${base}/manifest.json`, httpsOnly: false };
  const first = downloader.install('collection', opts);
  await assert.rejects(downloader.install('net', opts), /already running/);
  await first;
  assert.strictEqual(downloader.getProgress().phase, 'done');
  assert.strictEqual(downloader.getProgress().running, null);
  await assert.rejects(downloader.install('bogus', opts), /Unknown Bible download/);
  manifestBody = JSON.stringify({ files: [{ name: 'Missing.xml' }] });
  await assert.rejects(downloader.install('collection', opts), /failed/);
  assert.strictEqual(downloader.getProgress().phase, 'failed');
  fs.rmSync(dest, { recursive: true, force: true });
});

// ------------------------------------------------------- firstRunBibles

test('first-run offers Bible downloads only when the Bible Text plugin is enabled', () => {
  const on = firstRunBibles.getState({ config: { plugins: ['bibletext'] }, error() {}, log() {} });
  assert.strictEqual(on.available, true);
  assert.strictEqual(typeof on.net.installed, 'boolean');
  assert.strictEqual(typeof on.collection.installed, 'boolean');
  assert.deepStrictEqual(firstRunBibles.getState({ config: { plugins: ['addmedia'] } }), { available: false });
  assert.deepStrictEqual(firstRunBibles.getState({ config: {} }), { available: false });
});
