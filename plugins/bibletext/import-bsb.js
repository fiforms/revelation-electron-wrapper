// plugins/bibletext/import-bsb.js  (one-off developer CLI, not loaded by the app)
// Converts the Berean Standard Bible plain-text download into a Zefania XMLBIBLE file that
// localbiblemanager.js can load from ./bibles/ (it builds the .json cache itself).
// The BSB is public domain (dedicated April 30, 2023): https://berean.bible/licensing.htm
//
// Usage:
//   curl -o bsb.txt https://bereanbible.com/bsb.txt
//   node import-bsb.js bsb.txt [--out ./bibles]
//
// Input: tab-separated, three header lines, then one verse per line: "Genesis 1:1<TAB>text".
// Books must appear in canonical order (the file's order is used for bnumber). The BSB writes
// "Psalm"; it is renamed "Psalms" to match the other modules. Psalm titles are already part of
// verse 1's text in this file, like the NKJV/NASB/ESV modules.
// localbiblemanager.js maps verses by position, not by number, so a gap in the numbering would
// shift every later verse; gaps and missing chapters are reported and abort the conversion.
// Verses the BSB leaves blank (absent from the critical text, e.g. Matthew 17:21) stay as empty
// <VERS> elements so numbering stays aligned.
// Output: BSB.xml with identifier "bsb" (must be unique across ./bibles/).
const fs = require('fs');
const path = require('path');
const { buildZefaniaXml } = require('./usfm');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const outDir = path.resolve(opt('--out') || path.join(__dirname, 'bibles'));
const input = args[0];

if (!input) {
  console.error('Usage: node import-bsb.js <bsb.txt> [--out dir]');
  process.exit(1);
}

const BOOK_RENAMES = { Psalm: 'Psalms' };

const books = []; // { name, chapters: [[text, ...], ...] }
const problems = [];
const emptyVerses = [];
const lines = fs.readFileSync(input, 'utf8').replace(/^﻿/, '').split(/\r?\n/);

for (const line of lines) {
  const m = /^(.+?) (\d+):(\d+)\t(.*)$/.exec(line);
  if (!m) continue; // header lines and blanks
  const name = BOOK_RENAMES[m[1]] || m[1];
  const chapter = Number(m[2]);
  const verse = Number(m[3]);
  const text = m[4].replace(/\s+/g, ' ').trim();

  let book = books[books.length - 1];
  if (!book || book.name !== name) {
    book = { name, chapters: [] };
    books.push(book);
  }
  if (chapter !== book.chapters.length + 1 && chapter !== book.chapters.length) {
    problems.push(`${name} ${chapter}:${verse}: chapter out of sequence`);
  }
  const verses = book.chapters[chapter - 1] || (book.chapters[chapter - 1] = []);
  if (verse !== verses.length + 1) problems.push(`${name} ${chapter}:${verse}: expected verse ${verses.length + 1}`);
  if (!text) emptyVerses.push(`${name} ${chapter}:${verse}`);
  verses.push(text);
}

if (books.length !== 66) problems.push(`expected 66 books, found ${books.length}`);
if (problems.length) {
  problems.slice(0, 20).forEach(p => console.error(`⚠️ ${p}`));
  if (problems.length > 20) console.error(`⚠️ …and ${problems.length - 20} more`);
  process.exit(1);
}

const { xml, verseCount, emptyCount } = buildZefaniaXml({
  title: 'Berean Standard Bible',
  creator: 'Berean Bible Translation Committee',
  description: 'Berean Standard Bible (BSB), produced in cooperation with Bible Hub, Discovery Bible, unfoldingWord, Bible Aquifer and OpenBible.com.',
  publisher: 'Berean.Bible',
  date: new Date().toISOString().slice(0, 10),
  identifier: 'bsb',
  source: 'https://bereanbible.com/bsb.txt',
  language: 'ENG',
  rights: 'Public domain, dedicated April 30, 2023 - https://berean.bible/licensing.htm'
}, books.map((book, i) => ({ num: i + 1, name: book.name, chapters: book.chapters })));

fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'BSB.xml');
fs.writeFileSync(outFile, xml, 'utf8');
console.log(`✓ ${books.length} books, ${verseCount} verses → ${outFile}`);
console.log(`  ${emptyCount} verses are blank in the BSB: ${emptyVerses.join(', ')}`);
