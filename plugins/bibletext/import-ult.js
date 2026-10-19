// plugins/bibletext/import-ult.js  (one-off developer CLI, not loaded by the app)
// Converts the unfoldingWord Literal Text (ULT) or Simplified Text (UST) USFM files from
// https://git.door43.org/unfoldingWord/en_ult and /en_ust into a Zefania XMLBIBLE file that
// localbiblemanager.js can load from ./bibles/ (it builds the .json cache itself).
// Both are CC BY-SA 4.0, so keep the credit in <rights>/<contributors> if you redistribute them.
//
// Usage:
//   curl -L -o en_ult.zip https://git.door43.org/unfoldingWord/en_ult/archive/v91.zip && unzip en_ult.zip
//   node import-ult.js ./en_ult [--out ./bibles]        (also works for an unzipped en_ust)
//
// Input: one .usfm per book; the book comes from its \id line (front matter, A0-FRT, is skipped) and the
// version (ULT/UST) from the same line. The parsing rules (alignment markup, footnotes, psalm titles, verse
// ranges, gaps) are in usfm.js. Not every book is released yet; only the books present are written.
// Output: ULT.xml / UST.xml with identifier "ult" / "ust" (must be unique across ./bibles/).
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
  console.error('Usage: node import-ult.js <en_ult or en_ust folder> [--out dir]');
  process.exit(1);
}

const VERSIONS = {
  ULT: { name: 'unfoldingWord Literal Text', description: 'unfoldingWord Literal Text (ULT): a literal, form-centric English translation meant for translators.' },
  UST: { name: 'unfoldingWord Simplified Text', description: 'unfoldingWord Simplified Text (UST): a meaning-based English translation that clarifies what the ULT leaves implicit.' }
};

const files = fs.readdirSync(dir).filter(f => /\.usfm$/i.test(f)).sort();
if (!files.length) {
  console.error(`No .usfm files in ${dir}`);
  process.exit(1);
}

let versionKey = null;
const books = [];
const notes = [];
for (const file of files) {
  const usfm = fs.readFileSync(path.join(dir, file), 'utf8');
  const book = bookForUsfm(usfm);
  if (!book) continue; // front matter
  const idLine = /^\\id\s+\S+\s+EN_(ULT|UST)\b/m.exec(usfm);
  if (!idLine) throw new Error(`${file}: no "\\id CODE EN_ULT/EN_UST" line`);
  if (versionKey && versionKey !== idLine[1]) throw new Error(`${file}: mixes ${versionKey} and ${idLine[1]}`);
  versionKey = idLine[1];

  const parsed = parseUsfmBook(usfm, book.name);
  notes.push(...parsed.notes);
  books.push({ num: book.num, name: book.name, chapters: parsed.chapters });
}
if (!books.length) throw new Error(`No Bible books found in ${dir}`);
books.sort((a, b) => a.num - b.num);

const contributors = [];
const manifest = path.join(dir, 'manifest.yaml');
if (fs.existsSync(manifest)) {
  // contributor: list at the top of manifest.yaml; entries may be folded (">-") over several lines
  const lines = fs.readFileSync(manifest, 'utf8').split(/\r?\n/);
  const at = lines.findIndex(l => /^\s+contributor:\s*$/.test(l));
  let cur = null;
  for (let i = at + 1; at >= 0 && i < lines.length; i++) {
    const l = lines[i];
    const item = /^\s{4}-\s*(.*)$/.exec(l);
    if (item) {
      if (cur) contributors.push(cur);
      cur = item[1] === '>-' ? '' : item[1].replace(/^'(.*)'$/, '$1');
    } else if (/^\s{6,}\S/.test(l) && cur !== null) {
      cur = (cur ? `${cur} ` : '') + l.trim();
    } else {
      break;
    }
  }
  if (cur) contributors.push(cur);
}

const version = VERSIONS[versionKey];
const { xml, verseCount, emptyCount } = buildZefaniaXml({
  title: version.name,
  creator: 'unfoldingWord',
  description: version.description,
  publisher: 'unfoldingWord',
  contributors: contributors.join('; '),
  date: new Date().toISOString().slice(0, 10),
  identifier: versionKey.toLowerCase(),
  source: `https://git.door43.org/unfoldingWord/en_${versionKey.toLowerCase()}`,
  language: 'ENG',
  rights: 'CC BY-SA 4.0 - https://creativecommons.org/licenses/by-sa/4.0/ - unfoldingWord'
}, books);

fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${versionKey}.xml`);
fs.writeFileSync(outFile, xml, 'utf8');
console.log(`✓ ${versionKey}: ${books.length} books, ${verseCount} verses (${emptyCount} empty) → ${outFile}`);
const unusual = notes.filter(n => !/verse range/.test(n));
console.log(`  ${notes.length - unusual.length} verse ranges`);
unusual.slice(0, 20).forEach(n => console.warn(`  ⚠️ ${n}`));
if (unusual.length > 20) console.warn(`  ⚠️ …and ${unusual.length - 20} more`);
