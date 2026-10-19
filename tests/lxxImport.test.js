// plugins/bibletext/import-swete.js (Greek LXX from the Open Greek and Latin TEI) and import-lxx2012.js (English LXX from
// eBible USFM): run each CLI on a small fixture folder and read the result back through localbiblemanager.js.
// The Swete cases are the irregularities found in the real First1KGreek files (see the script header).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { installElectronStub } = require('./helpers/electron-stub');

installElectronStub();

// localbiblemanager.js logs emoji progress lines; they intermittently trip the node:test runner's stdout parsing.
console.log = () => {};

const localBibles = require('../plugins/bibletext/localbiblemanager');
const { bookForUsfm, DEUTEROCANON } = require('../plugins/bibletext/usfm');

const SWETE = path.join(__dirname, '..', 'plugins', 'bibletext', 'import-swete.js');
const LXX2012 = path.join(__dirname, '..', 'plugins', 'bibletext', 'import-lxx2012.js');
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), `revelation-${prefix}-`));

const LICENCE = '<licence target="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</licence>';
const tei = (inner, licence = LICENCE) => `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><publicationStmt><availability>${licence}</availability></publicationStmt></fileDesc></teiHeader>
<text><body><div type="edition" n="urn:x" xml:lang="grc">${inner}</div></body></text></TEI>`;
const chapter = (n, inner) => `<div type="textpart" subtype="chapter" n="${n}">${inner}</div>`;
const verse = (n, inner) => `<div type="textpart" subtype="verse" n="${n}"><p>${inner}</p></div>`;

function writeTlg(root, id, xml, suffix = 'grc1') {
  fs.mkdirSync(path.join(root, `tlg${id}`), { recursive: true });
  fs.writeFileSync(path.join(root, `tlg${id}`, `tlg0527.tlg${id}.1st1K-${suffix}.xml`), xml);
}

async function runAndLoad(script, input, expectedId) {
  const out = tmp('lxx-out');
  execFileSync(process.execPath, [script, input, '--out', out], { encoding: 'utf8' });
  await localBibles.loadBibles(out);
  const bible = localBibles.biblelist.find((b) => b.info.identifier === expectedId);
  assert.ok(bible, `${expectedId} loaded`);
  const json = JSON.parse(fs.readFileSync(bible.path, 'utf8'));
  return { json, books: Object.fromEntries(json.books.map((b) => [b.name, b])), out };
}

test('Swete: apparatus is dropped, sub-labeled verses join their base verse, gaps stay empty, digits are stripped', async () => {
  const root = tmp('swete');
  writeTlg(root, '001', tei(chapter(1,
    '<pb n="1"/><head>ΓΕΝΕΣΙΣ</head>'
    + verse(1, 'ἐν ἀρχῇ <note type="marginal">A</note>ἐποίησεν <lb n="2"/> ὁ θεὸς¶ <del>ν</del>τὸν οὐρανόν <add>καὶ</add> τὴν γῆν.')
    + verse(2, 'ἡ δὲ γῆ <milestone unit="x"/> ἦν (13) 1ἀόρατος ,')
    + verse('2a', 'ἄλλη ἀνάγνωσις')
    + verse(4, 'τέταρτον')) + chapter(2, verse(1, 'δεύτερον'))));
  const { books } = await runAndLoad(SWETE, root, 'lxx-swete');
  const g = books.Genesis.chapters;
  assert.strictEqual(g[0][0], 'ἐν ἀρχῇ ἐποίησεν ὁ θεὸς τὸν οὐρανόν καὶ τὴν γῆν.', 'notes, head, line breaks, deletions dropped; add kept');
  assert.strictEqual(g[0][1], 'ἡ δὲ γῆ ἦν ἀόρατος, ἄλλη ἀνάγνωσις', 'digits and (13) stripped, 2a appended to 2');
  assert.strictEqual(g[0][2], '', 'verse 3 is absent in the source and stays an empty position');
  assert.strictEqual(g[0][3], 'τέταρτον');
  assert.strictEqual(g[1][0], 'δεύτερον');
  fs.rmSync(root, { recursive: true, force: true });
});

test('Swete: non-numeric chapters go after the numbered ones, a chapterless book is one chapter, a head verse leads verse 1', async () => {
  const root = tmp('swete2');
  writeTlg(root, '019', tei(chapter('prologue', verse(1, 'προοίμιον')) + chapter(1, verse(1, 'ἐγένετο')) + chapter(2, verse(1, 'μετά'))));
  writeTlg(root, '028', tei(chapter(1, verse(1, 'α')) + chapter('iva', verse(1, 'δ')) + chapter('ivb', verse(1, 'δβ')) + chapter(5, verse(1, 'ε'))));
  writeTlg(root, '052', tei(`<p>ἀντίγραφον</p>${verse(1, 'διὰ τὰς ἁμαρτίας')}${verse(2, 'εἰσελθόντες')}`));
  writeTlg(root, '048', tei(chapter(1, verse(1, 'ὅρασις')) + chapter(2, `<div type="textpart" subtype="verse" n="head"><p>τάδε λέγει</p></div>${verse(1, 'ἰδοὺ')}`)));
  const { books } = await runAndLoad(SWETE, root, 'lxx-swete');
  assert.deepStrictEqual(books.Esther.chapters, [['ἐγένετο'], ['μετά'], ['προοίμιον']], 'prologue is an extra last chapter, chapters 1-2 keep their numbers');
  assert.deepStrictEqual(books.Odes.chapters, [['α'], [], [], ['δ'], ['ε'], ['δβ']], 'iva is chapter 4, ivb an extra last chapter, 2 and 3 are empty positions');
  assert.deepStrictEqual(books['Letter of Jeremiah'].chapters, [['ἀντίγραφον διὰ τὰς ἁμαρτίας', 'εἰσελθόντες']], 'no chapter divs: one chapter; the superscription leads verse 1');
  assert.deepStrictEqual(books.Isaiah.chapters, [['ὅρασις'], ['τάδε λέγει ἰδοὺ']], 'a "head" verse before verse 1 is prepended to verse 1');
  fs.rmSync(root, { recursive: true, force: true });
});

test('Swete: only the grc1 file is used, and a file without the CC BY-SA licence is refused', async () => {
  const root = tmp('swete3');
  writeTlg(root, '034', tei(chapter(1, verse(1, 'Swete'))), 'grc1');
  writeTlg(root, '034', tei(chapter(1, verse(1, 'another edition'))), 'grc2');
  const { books } = await runAndLoad(SWETE, root, 'lxx-swete');
  assert.strictEqual(books.Sirach.chapters[0][0], 'Swete');
  fs.rmSync(root, { recursive: true, force: true });

  const bad = tmp('swete4');
  writeTlg(bad, '001', tei(chapter(1, verse(1, 'x')), '<licence>All rights reserved</licence>'));
  const res = spawnSync(process.execPath, [SWETE, bad, '--out', tmp('never')], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /does not state the CC BY-SA 4\.0 licence/);
  fs.rmSync(bad, { recursive: true, force: true });
});

test('Swete output carries the licence credit and the identifier the app expects', async () => {
  const root = tmp('swete5');
  writeTlg(root, '001', tei(chapter(1, verse(1, 'x'))));
  const { json } = await runAndLoad(SWETE, root, 'lxx-swete');
  assert.match(json.info.rights, /CC BY-SA 4\.0/);
  assert.strictEqual(json.info.language, 'GRC');
  assert.match(json.info.source, /First1KGreek/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('LXX2012 converter reads the canonical and extra books and skips front matter', async () => {
  const dir = tmp('lxx2012');
  const usfm = (code, body) => `\\id ${code}  \n\\h x\n\\c 1\n\\p\n${body}`;
  fs.writeFileSync(path.join(dir, '00-FRTeng-lxx2012.usfm'), '\\id FRT - Brenton English Septuagint\n\\h Abbreviations\n\\mt1 ABBREVIATIONS');
  fs.writeFileSync(path.join(dir, '01-INTeng-lxx2012.usfm'), '\\id INT - Brenton English Septuagint\n\\h Introduction');
  fs.writeFileSync(path.join(dir, '02-GENeng-lxx2012.usfm'), usfm('GEN', '\\v 1 In the beginning God made the heaven and the earth.'));
  fs.writeFileSync(path.join(dir, '41-TOBeng-lxx2012.usfm'), usfm('TOB', '\\v 1 The book of the words of Tobit.\\f + \\fr 1:1 \\ft a note\\f*'));
  const { json, books } = await runAndLoad(LXX2012, dir, 'lxx2012');
  assert.deepStrictEqual(json.books.map((b) => [b.num, b.name]), [[1, 'Genesis'], [67, 'Tobit']]);
  assert.strictEqual(books.Tobit.chapters[0][0], 'The book of the words of Tobit.');
  assert.match(json.info.rights, /Public domain/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('deuterocanonical book codes are found only when asked for', () => {
  assert.strictEqual(DEUTEROCANON.length, 15);
  assert.strictEqual(DEUTEROCANON[0].num, 67);
  assert.strictEqual(bookForUsfm('\\id SIR'), null, 'the NET installer must never see them');
  assert.strictEqual(bookForUsfm('\\id SIR', { deuterocanon: true }).name, 'Sirach');
  assert.strictEqual(bookForUsfm('\\id GEN', { deuterocanon: true }).num, 1);
});
