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

// ------------------------------------------------------- language groups

const bibleGroups = require('../plugins/bibletext/bibleGroups');
const { buildManifest } = require('../plugins/bibletext/bibles/make-manifest');
const zlib = require('zlib');

test('groupForLanguage: ISO-3 and BCP-47, ancient vs modern Hebrew and Greek', () => {
  const g = bibleGroups.groupForLanguage;
  assert.deepStrictEqual(['ENG', 'en-GB', 'en_US', 'eng', ' en '].map(g), Array(5).fill('english'));
  assert.deepStrictEqual(['SPA', 'es-ES', 'es-419'].map(g), Array(3).fill('spanish'));
  assert.deepStrictEqual(['GRC', 'HEB', 'lat'].map(g), Array(3).fill('ancient'));
  assert.deepStrictEqual(['he-IL', 'el', 'FRE', 'ja-JP', '', undefined].map(g), Array(6).fill('other'));
});

test('group labels and order: known first, unknown ones title-cased after', () => {
  assert.strictEqual(bibleGroups.labelForGroup('ancient'), 'Ancient Languages');
  assert.strictEqual(bibleGroups.labelForGroup('portuguese'), 'Portuguese');
  assert.strictEqual(bibleGroups.labelForGroup('study-bibles'), 'Study bibles');
  assert.deepStrictEqual(bibleGroups.orderGroups(['other', 'zulu', 'english', 'ancient', 'afrikaans', 'spanish', 'english']),
    ['english', 'spanish', 'ancient', 'other', 'afrikaans', 'zulu']);
  assert.deepStrictEqual(bibleGroups.defaultGroups('es'), ['spanish', 'english']);
  assert.deepStrictEqual(bibleGroups.defaultGroups('es-MX'), ['spanish', 'english']);
  assert.deepStrictEqual(bibleGroups.defaultGroups('en'), ['english']);
  assert.deepStrictEqual(bibleGroups.defaultGroups(undefined), ['english']);
});

const bibleXml = (title, language, identifier = title.toLowerCase().replace(/\W+/g, '')) => buildZefaniaXml({
  title, creator: '', description: '', publisher: '', date: '2026-01-01', identifier, source: '', language, rights: ''
}, [{ num: 1, name: 'Genesis', chapters: [['x']] }]).xml;

test('make-manifest lists title, language, size and group, prefers .gz, and honors groups.json', () => {
  const dir = tmp('manifest');
  fs.writeFileSync(path.join(dir, 'KJV.xml'), bibleXml('King James & Co', 'ENG', 'KJV'));
  fs.writeFileSync(path.join(dir, 'KJV.xml.gz'), zlib.gzipSync(bibleXml('King James & Co', 'ENG', 'KJV')));
  fs.writeFileSync(path.join(dir, 'OSHB.xml'), bibleXml('Hebrew Bible', 'HEB'));
  fs.writeFileSync(path.join(dir, 'OTB_he-IL.xml'), bibleXml('Modern Hebrew', 'he-IL'));
  fs.writeFileSync(path.join(dir, 'OTB_pt-BR.xml'), bibleXml('Portuguese', 'pt-BR'));
  fs.writeFileSync(path.join(dir, 'RV.xml'), bibleXml('Reina', 'SPA'));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
  fs.writeFileSync(path.join(dir, 'groups.json'), JSON.stringify({ 'OTB_pt-BR': 'portuguese' }));

  const manifest = buildManifest(dir);
  const byName = Object.fromEntries(manifest.files.map((f) => [f.name, f]));
  assert.deepStrictEqual(Object.keys(byName).sort(), ['KJV.xml.gz', 'OSHB.xml', 'OTB_he-IL.xml', 'OTB_pt-BR.xml', 'RV.xml']);
  assert.strictEqual(byName['KJV.xml.gz'].title, 'King James & Co');
  assert.strictEqual(byName['KJV.xml.gz'].group, 'english');
  assert.strictEqual(byName['KJV.xml.gz'].sha256, sha256(fs.readFileSync(path.join(dir, 'KJV.xml.gz'))));
  assert.strictEqual(byName['KJV.xml.gz'].size, fs.statSync(path.join(dir, 'KJV.xml.gz')).size);
  assert.strictEqual(byName['OSHB.xml'].group, 'ancient');
  assert.strictEqual(byName['OTB_he-IL.xml'].group, 'other');
  assert.strictEqual(byName['OTB_pt-BR.xml'].group, 'portuguese');
  assert.strictEqual(byName['RV.xml'].group, 'spanish');
  assert.strictEqual(buildManifest(tmp('empty')), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

function groupedManifest(entries) {
  manifestBody = JSON.stringify({
    files: entries.map(([name, group, title, size]) => {
      const body = Buffer.from(`<bible>${name}</bible>`);
      files.set(`/${name}`, body);
      return { name, sha256: sha256(body), size, title, ...(group ? { group } : {}) };
    })
  });
}

test('getCollectionGroups counts per group, leaves out bundled files, and treats a missing group as "other"', async () => {
  groupedManifest([
    ['KJV.xml.gz', 'english', 'King James', 1000],
    ['WEB.xml', 'english', 'World English', 2000],
    ['RV.xml', 'spanish', 'Reina', 3000],
    ['LXX.xml', 'ancient', 'Septuagint', 4000],
    ['FR.xml', null, 'French', 5000],
    ['../evil.xml', 'english', 'Evil', 1]
  ]);
  const groups = await downloader.getCollectionGroups({ manifestUrl: `${base}/manifest.json`, skipNames: ['kjv'], httpsOnly: false });
  assert.deepStrictEqual(groups.map((g) => [g.id, g.label, g.count, g.bytes]), [
    ['english', 'English', 1, 2000],
    ['spanish', 'Spanish', 1, 3000],
    ['ancient', 'Ancient Languages', 1, 4000],
    ['other', 'Other Languages', 1, 5000]
  ]);
  assert.deepStrictEqual(groups[0].titles, ['World English']);
  assert.deepStrictEqual(groups.map((g) => [g.id, g.bundled, g.installed]), [
    ['english', 1, false], ['spanish', 0, false], ['ancient', 0, false], ['other', 0, false]
  ]);
});

test('a group fully covered by bundled Bibles is still listed, as already included (a dev checkout bundles everything)', async () => {
  groupedManifest([
    ['KJV.xml.gz', 'english', 'King James', 1000],
    ['WEB.xml', 'english', 'World English', 2000],
    ['LXX.xml', 'ancient', 'Septuagint', 4000],
    ['FR.xml', 'other', 'French', 5000]
  ]);
  const dest = tmp('included');
  const groups = await downloader.getCollectionGroups({
    manifestUrl: `${base}/manifest.json`, skipNames: ['kjv', 'web', 'lxx'], httpsOnly: false, destDir: dest
  });
  assert.deepStrictEqual(groups.map((g) => [g.id, g.count, g.bundled, g.installed]), [
    ['english', 0, 2, true], ['ancient', 0, 1, true], ['other', 1, 0, false]
  ]);

  // Downloaded before (marker) also counts as installed, even though files remain to compare.
  await downloader.installCollection({ destDir: dest, manifestUrl: `${base}/manifest.json`, httpsOnly: false, groups: ['other'] });
  const after = await downloader.getCollectionGroups({
    manifestUrl: `${base}/manifest.json`, skipNames: ['kjv', 'web', 'lxx'], httpsOnly: false, destDir: dest
  });
  assert.strictEqual(after.find((g) => g.id === 'other').installed, true);
  fs.rmSync(dest, { recursive: true, force: true });
});

test('installCollection downloads only the chosen groups, and the marker accumulates installed groups', async () => {
  groupedManifest([
    ['WEB.xml', 'english', 'World English', 1],
    ['RV.xml', 'spanish', 'Reina', 1],
    ['LXX.xml', 'ancient', 'Septuagint', 1],
    ['FR.xml', 'other', 'French', 1]
  ]);
  const dest = tmp('groups');
  const opts = { destDir: dest, manifestUrl: `${base}/manifest.json`, httpsOnly: false };

  const first = await downloader.installCollection({ ...opts, groups: ['spanish', 'english'] });
  assert.deepStrictEqual(first.downloaded.sort(), ['RV.xml', 'WEB.xml']);
  assert.deepStrictEqual(downloader.getStatus(dest).collection, { installed: true, groups: ['english', 'spanish'] });
  assert.ok(!fs.existsSync(path.join(dest, 'LXX.xml')));

  const second = await downloader.installCollection({ ...opts, groups: ['ancient'] });
  assert.deepStrictEqual(second.downloaded, ['LXX.xml']);
  assert.deepStrictEqual(downloader.getStatus(dest).collection.groups, ['english', 'spanish', 'ancient']);

  await assert.rejects(downloader.installCollection({ ...opts, groups: [] }), /at least one group/);
  await assert.rejects(downloader.installCollection({ ...opts, groups: ['../x', 7, null] }), /at least one group/);
  await assert.rejects(downloader.installCollection({ ...opts, groups: 'english' }), /list of group ids/);
  await assert.rejects(downloader.installCollection({ ...opts, groups: ['klingon'] }), /no files in the chosen groups/);

  const all = await downloader.installCollection(opts); // no groups: everything (fetch-bibles.js)
  assert.deepStrictEqual(all.downloaded, ['FR.xml']);
  assert.deepStrictEqual(downloader.getStatus(dest).collection.groups, ['english', 'spanish', 'ancient', 'other']);
  fs.rmSync(dest, { recursive: true, force: true });
});

// ------------------------------------------------------- copyright dialog API

test('get-local-translation-info returns the module\'s own copyright block, trimmed, and only known non-empty fields', async () => {
  const plugin = require('../plugins/bibletext/plugin.js');
  const dir = tmp('info');
  fs.writeFileSync(path.join(dir, 'T.xml'), buildZefaniaXml({
    title: 'Test Bible', creator: 'A <b>Person</b>', description: '', publisher: 'Pub & Co', contributors: '',
    date: '2026-01-01', identifier: 'tst', source: 'https://example.org/tst', language: 'ENG',
    rights: 'CC BY-SA 4.0 - https://creativecommons.org/licenses/by-sa/4.0/'
  }, [{ num: 1, name: 'Genesis', chapters: [['x']] }]).xml);
  await localBibles.loadBibles(dir);

  const res = await plugin.api['get-local-translation-info']({}, { translation: 'TST.local' });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.name, 'Test Bible');
  assert.strictEqual(res.info.rights, 'CC BY-SA 4.0 - https://creativecommons.org/licenses/by-sa/4.0/');
  assert.strictEqual(res.info.creator, 'A <b>Person</b>', 'text is returned as is; the reader shows it with textContent');
  assert.strictEqual(res.info.publisher, 'Pub & Co');
  assert.ok(!('description' in res.info) && !('contributors' in res.info), 'empty fields are left out');
  assert.ok(!('coverage' in res.info) && !('format' in res.info), 'only the known fields');

  assert.strictEqual((await plugin.api['get-local-translation-info']({}, { translation: 'nope.local' })).success, false);
  assert.strictEqual((await plugin.api['get-local-translation-info']({}, {})).success, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------- Install XML Bible Module, and reloading the list

const { electronStub } = require('./helpers/electron-stub');

const moduleXml = (title, identifier, text = 'In the beginning.') => bibleXml(title, 'ENG', identifier).replace('<VERS vnumber="1">x</VERS>', `<VERS vnumber="1">${text}</VERS>`);

test('installBibleFile checks a module, copies it, and replaces a file of the same name', async () => {
  const src = tmp('pick');
  const dest = tmp('mine');
  fs.writeFileSync(path.join(src, 'My Bible.xml'), moduleXml('My Bible', 'mine'));
  fs.writeFileSync(path.join(src, 'Zipped.xml.gz'), zlib.gzipSync(moduleXml('Zipped Bible', 'zipped')));

  const a = await downloader.installBibleFile({ srcPath: path.join(src, 'My Bible.xml'), destDir: dest });
  assert.deepStrictEqual([a.name, a.identifier, a.books, a.verses], ['My Bible', 'mine', 1, 1]);
  const b = await downloader.installBibleFile({ srcPath: path.join(src, 'Zipped.xml.gz'), destDir: dest });
  assert.strictEqual(b.identifier, 'zipped');
  assert.deepStrictEqual(fs.readdirSync(dest).sort(), ['My Bible.xml', 'Zipped.xml.gz'], 'no .part or probe files left behind');

  // The same file name again is an update: it replaces the old file and drops the stale cache.
  fs.writeFileSync(path.join(dest, 'My Bible.json'), '{"stale":true}');
  fs.writeFileSync(path.join(src, 'My Bible.xml'), moduleXml('My Bible', 'mine', 'Updated text.'));
  await downloader.installBibleFile({ srcPath: path.join(src, 'My Bible.xml'), destDir: dest, existing: [{ identifier: 'mine', base: 'My Bible' }] });
  assert.match(fs.readFileSync(path.join(dest, 'My Bible.xml'), 'utf8'), /Updated text\./);
  assert.ok(!fs.existsSync(path.join(dest, 'My Bible.json')));
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(dest, { recursive: true, force: true });
});

test('installBibleFile refuses non-Bibles, empty Bibles, bad extensions, bad gzip and a clashing identifier, leaving nothing behind', async () => {
  const src = tmp('pick2');
  const dest = tmp('mine2');
  const write = (name, content) => { fs.writeFileSync(path.join(src, name), content); return path.join(src, name); };
  const cases = [
    [write('notes.txt', 'hello'), /ending in \.xml or \.xml\.gz/],
    [write('page.xml', '<html><body>Not a Bible</body></html>'), /not a Bible module/],
    [write('garbage.xml', 'this is not xml at all'), /not a Bible module/],
    [write('empty.xml', bibleXml('Empty', 'ENG', 'emptybible').replace(/<BIBLEBOOK[\s\S]*<\/BIBLEBOOK>/, '')), /no Bible text|not a Bible module/],
    [write('bad.xml.gz', 'not gzip'), /not a valid \.gz/]
  ];
  for (const [file, message] of cases) {
    await assert.rejects(downloader.installBibleFile({ srcPath: file, destDir: dest }), message, file);
  }
  await assert.rejects(downloader.installBibleFile({ srcPath: src, destDir: dest }), /ending in \.xml|not a file/i, 'a folder');

  const clash = write('Other Name.xml', moduleXml('Dup', 'kjv'));
  await assert.rejects(
    downloader.installBibleFile({ srcPath: clash, destDir: dest, existing: [{ identifier: 'KJV', base: 'SF_2009-01-23_ENG_KJV_(KING JAMES VERSION)' }] }),
    /identifier "kjv" is already installed/);
  assert.deepStrictEqual(fs.readdirSync(dest), [], 'nothing was copied');

  // An odd file name is cleaned, never used to leave the folder.
  const odd = write('..weird<name>.xml', moduleXml('Odd', 'odd'));
  const done = await downloader.installBibleFile({ srcPath: odd, destDir: dest });
  assert.strictEqual(path.dirname(done.file), dest);
  assert.ok(!/[<>]/.test(path.basename(done.file)) && !path.basename(done.file).startsWith('.'), path.basename(done.file));
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(dest, { recursive: true, force: true });
});

test('install-bible-file: cancelled dialog does nothing; a picked file is installed and shows up in the list at once', async () => {
  const plugin = require('../plugins/bibletext/plugin.js');
  const ctx = {
    log() {}, error() {}, translate: (s) => s, config: { pluginFolder: '/nonexistent', language: 'en' },
    plugins: { bibletext: { config: {}, getCfg: () => ({ bibleAPI: 'none', esvApiKey: '' }) } }
  };
  plugin.register(ctx);
  const userBibles = path.join(electronStub.app.getPath('userData'), 'bibles');
  fs.rmSync(userBibles, { recursive: true, force: true });

  electronStub.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  assert.deepStrictEqual(await plugin.api['install-bible-file']({}), { success: false, canceled: true });

  const src = tmp('pick3');
  fs.writeFileSync(path.join(src, 'Picked.xml'), moduleXml('Picked Bible', 'picked'));
  electronStub.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(src, 'Picked.xml')] });
  const res = await plugin.api['install-bible-file']({});
  assert.strictEqual(res.success, true, JSON.stringify(res));
  assert.deepStrictEqual([res.name, res.identifier, res.books], ['Picked Bible', 'picked', 1]);
  assert.ok(fs.existsSync(path.join(userBibles, 'Picked.xml')));
  assert.ok(fs.existsSync(path.join(userBibles, 'Picked.json')), 'the .json cache was built without a restart');
  const list = await plugin.api['get-local-translations']();
  assert.ok(list.translations.some((t) => t.id === 'PICKED.local'), 'the reader sees it immediately');

  // The same translation under a different file name is refused, and the list stays as it was.
  fs.writeFileSync(path.join(src, 'Copy.xml'), moduleXml('Picked Bible again', 'picked'));
  electronStub.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(src, 'Copy.xml')] });
  const dup = await plugin.api['install-bible-file']({});
  assert.strictEqual(dup.success, false);
  assert.match(dup.error, /already installed/);
  assert.ok(!fs.existsSync(path.join(userBibles, 'Copy.xml')));
  fs.rmSync(src, { recursive: true, force: true });
});

test('a failed or partial first-run download still reloads the live Bible list', async () => {
  const handlers = {};
  firstRunBibles.register({ handle: (name, fn) => { handlers[name] = fn; } }, null);
  let reloads = 0;
  const ctx = {
    log() {}, error() {}, config: { plugins: ['bibletext'] },
    plugins: { bibletext: { reloadBibles: async () => { reloads++; } } }
  };
  firstRunBibles.register({ handle: (name, fn) => { handlers[name] = (event, payload) => fn(event, payload); } }, ctx);
  const event = { sender: { isDestroyed: () => true, send() {} } };
  const res = await handlers['first-run:install-bibles'](event, { id: 'not-a-real-download' });
  assert.strictEqual(res.success, false);
  assert.match(res.error, /Unknown Bible download/);
  assert.strictEqual(reloads, 1, 'reloaded even though the download failed');

  // Plugin disabled: nothing is offered and nothing is reloaded.
  const off = { ...ctx, config: { plugins: [] } };
  firstRunBibles.register({ handle: (name, fn) => { handlers[name] = (e, p) => fn(e, p); } }, off);
  assert.strictEqual((await handlers['first-run:install-bibles'](event, { id: 'net' })).success, false);
  assert.strictEqual(reloads, 1);
});
