// plugins/bibletext/import-lxx2012.js  (one-off developer CLI, not loaded by the app)
// Converts eBible.org's LXX2012, the Septuagint in English (Sir Lancelot Brenton's translation with spelling updates),
// into a Zefania XMLBIBLE file that localbiblemanager.js can load from ./bibles/ (it builds the .json cache itself).
// Public domain: Brenton's translation is old, and the LXX2012 language updates are dedicated to the public domain by
// Michael Paul Johnson (see copr.htm in the zip).
//
// WHERE TO GET THE SOURCE FILES (USFM, one zip, American English):
//   https://ebible.org/find/show.php?id=eng-lxx2012      (the page; "USFM" download)
//   https://ebible.org/Scriptures/eng-lxx2012_usfm.zip   (direct link)
//   (a British-spelling variant, eng-uk-lxx2012, is on the same site; this script handles either)
// Usage:
//   curl -L -o eng-lxx2012_usfm.zip https://ebible.org/Scriptures/eng-lxx2012_usfm.zip
//   mkdir lxx2012 && unzip -d lxx2012 eng-lxx2012_usfm.zip        (unzip into its own empty folder)
//   node import-lxx2012.js ./lxx2012 [--out ./bibles]
//
// Input: one .usfm per book; the book comes from its \id line. The 66 canonical books plus the Septuagint's extra
// books (Tobit, Judith, Wisdom, Sirach, Baruch, the Maccabees ...) are read; front matter (FRT, INT) is skipped.
// The parsing rules (footnotes, psalm titles, verse ranges, gaps) are in usfm.js.
// Notes on what this text is: the Psalms follow the Septuagint numbering (Psalm 22 here is Psalm 23 in English
// Bibles), Esther includes its Greek additions inside the book, and Ezra-Nehemiah are the two books they are in
// the Hebrew Bible (this translation's 2 Esdras is not a separate book).
// Output: LXX2012.xml with identifier "lxx2012" (must be unique across ./bibles/). Bible numbers: canonical books
// 1-66, then 67 up for the extras (see usfm.js DEUTEROCANON).
const fs = require('fs');
const path = require('path');
const { bookForUsfm, parseUsfmBook, buildZefaniaXml } = require('./usfm');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const outDir = path.resolve(opt('--out') || path.join(__dirname, 'bibles'));
const dir = args[0];

if (!dir) {
  console.error('Usage: node import-lxx2012.js <folder with the unzipped USFM> [--out dir]');
  process.exit(1);
}

const files = fs.readdirSync(dir).filter(f => /\.usfm$/i.test(f)).sort();
if (!files.length) {
  console.error(`No .usfm files in ${dir}`);
  process.exit(1);
}

const books = [];
const notes = [];
for (const file of files) {
  const usfm = fs.readFileSync(path.join(dir, file), 'utf8');
  const book = bookForUsfm(usfm, { deuterocanon: true });
  if (!book) continue; // front matter, introduction
  const parsed = parseUsfmBook(usfm, book.name);
  notes.push(...parsed.notes);
  books.push({ num: book.num, name: book.name, chapters: parsed.chapters });
}
if (!books.length) throw new Error(`No Bible books found in ${dir}`);
books.sort((a, b) => a.num - b.num);

const { xml, verseCount, emptyCount } = buildZefaniaXml({
  title: 'Septuagint in English (Brenton, LXX2012)',
  creator: 'Sir Lancelot C. L. Brenton (translator)',
  description: 'The Septuagint in English: Brenton\'s translation with spelling updates (LXX2012), including the Septuagint\'s extra books. '
    + 'The Psalms follow the Septuagint numbering (Psalm 22 here is Psalm 23 in English Bibles).',
  publisher: 'eBible.org',
  contributors: 'Michael Paul Johnson (LXX2012 language updates)',
  date: new Date().toISOString().slice(0, 10),
  identifier: 'lxx2012',
  source: 'https://ebible.org/eng-lxx2012/',
  language: 'ENG',
  rights: 'Public domain. Brenton\'s translation of the Septuagint; the LXX2012 language updates are dedicated to the public domain by Michael Paul Johnson (https://ebible.org/eng-lxx2012/).'
}, books);

fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'LXX2012.xml');
fs.writeFileSync(outFile, xml, 'utf8');
console.log(`✓ LXX2012: ${books.length} books, ${verseCount} verses (${emptyCount} empty) → ${outFile}`);
console.log(`  ${books.map(b => b.name).join(', ')}`);
const unusual = notes.filter(n => !/verse range/.test(n));
console.log(`  ${notes.length - unusual.length} verse ranges`);
unusual.slice(0, 20).forEach(n => console.warn(`  ⚠️ ${n}`));
if (unusual.length > 20) console.warn(`  ⚠️ …and ${unusual.length - 20} more`);
