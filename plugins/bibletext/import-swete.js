// plugins/bibletext/import-swete.js  (one-off developer CLI, not loaded by the app)
// Converts the Open Greek and Latin project's digital text of Swete's Septuagint ("The Old Testament in Greek",
// Cambridge 1901-1930) into a Zefania XMLBIBLE file that localbiblemanager.js can load from ./bibles/ (it builds the
// .json cache itself).
//
// LICENSE: Swete's printed edition is public domain; the digital text (First1KGreek, tlg0527) is CC BY-SA 4.0, stated in
// every file's TEI header (<licence target="https://creativecommons.org/licenses/by-sa/4.0/">). The output keeps that
// credit in <rights>, so keep it if you redistribute the file (share-alike).
//
// WHERE TO GET THE SOURCE FILES: the First1KGreek repository, only its data/tlg0527 folder (the repository is ~1 GB):
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/OpenGreekAndLatin/First1KGreek.git
//   cd First1KGreek && git sparse-checkout set data/tlg0527
//   (the files are then in First1KGreek/data/tlg0527/tlgNNN/tlg0527.tlgNNN.1st1K-grc1.xml)
//   Project page: https://opengreekandlatin.github.io/First1KGreek/   Swete's scans: https://archive.org/details/oldtestamentingr01swetuoft
// Usage:
//   node import-swete.js ./First1KGreek/data/tlg0527 [--out ./bibles]
//
// What is converted: only the *-grc1.xml files, which are Swete's text. (The -grc2 files are other editions: a second
// Sirach text and Ottley's Isaiah.) Files are TEI: <div chapter n> / <div verse n> / <p> and <l> lines.
// Rules (all of them keep the text; nothing but apparatus is dropped):
//   - Dropped: <note> (Swete's apparatus and manuscript sigla), <head> (book titles), page/line breaks, <del>
//     (editorial deletions); the characters ¶ § [ ] and stray digits are removed. <add> text is kept.
//   - A verse label with a suffix (35a, 24b, 1a1: Swete prints extra readings and parallel texts under these)
//     is appended to its base verse (35, 24, 1), so positions stay aligned with the numbered verses.
//   - Verse numbers the source skips (Swete's Vaticanus text lacks e.g. 1 Samuel 17:12-31) stay as empty verses,
//     because localbiblemanager.js maps verses by position, not by number.
//   - A chapter label that is not a number (Esther's "prologue", Sirach's "prologue", the second part "ivb" of Ode 4)
//     becomes an extra chapter after the last numbered one. Roman "iva" is chapter 4.
//   - A book with no chapter divisions (the Letter of Jeremiah) is one chapter.
//   - Text before the first verse of a chapter that is not a heading (the Letter of Jeremiah's superscription) is
//     prepended to verse 1, like a psalm title in the other modules.
// What the source does NOT have: Ecclesiastes (the tlg030 folder has no text), Joshua and Judges in the Alexandrinus
// (A) text, Tobit in the Sinaiticus text. The Psalms use the Septuagint numbering (Psalm 22 here is Psalm 23 in
// English Bibles). Joshua and Judges are Swete's B (Vaticanus) text.
// Output: LXX_Swete.xml with identifier "lxx-swete" (must be unique across ./bibles/). Bible numbers are 1..N in Swete's
// order (canonical books first; the extras where he prints them).
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const { buildZefaniaXml } = require('./usfm');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const outDir = path.resolve(opt('--out') || path.join(__dirname, 'bibles'));
const dir = args[0];

if (!dir) {
  console.error('Usage: node import-swete.js <First1KGreek/data/tlg0527 folder> [--out dir]');
  process.exit(1);
}

// tlg id -> book name, in output order. Missing ids (007, 009, 022, 030) are not in the source.
const BOOKS = [
  ['001', 'Genesis'], ['002', 'Exodus'], ['003', 'Leviticus'], ['004', 'Numbers'], ['005', 'Deuteronomy'],
  ['006', 'Joshua'], ['008', 'Judges'], ['010', 'Ruth'],
  ['011', '1 Samuel (1 Kingdoms)'], ['012', '2 Samuel (2 Kingdoms)'], ['013', '1 Kings (3 Kingdoms)'], ['014', '2 Kings (4 Kingdoms)'],
  ['015', '1 Chronicles'], ['016', '2 Chronicles'], ['017', '1 Esdras'], ['018', '2 Esdras (Ezra-Nehemiah)'],
  ['019', 'Esther'], ['020', 'Judith'], ['021', 'Tobit'],
  ['023', '1 Maccabees'], ['024', '2 Maccabees'], ['025', '3 Maccabees'], ['026', '4 Maccabees'],
  ['027', 'Psalms'], ['028', 'Odes'], ['029', 'Proverbs'], ['031', 'Song of Solomon'], ['032', 'Job'],
  ['033', 'Wisdom of Solomon'], ['034', 'Sirach'], ['035', 'Psalms of Solomon'],
  ['036', 'Hosea'], ['037', 'Amos'], ['038', 'Micah'], ['039', 'Joel'], ['040', 'Obadiah'], ['041', 'Jonah'],
  ['042', 'Nahum'], ['043', 'Habakkuk'], ['044', 'Zephaniah'], ['045', 'Haggai'], ['046', 'Zechariah'], ['047', 'Malachi'],
  ['048', 'Isaiah'], ['049', 'Jeremiah'], ['050', 'Baruch'], ['051', 'Lamentations'], ['052', 'Letter of Jeremiah'],
  ['053', 'Ezekiel'],
  ['054', 'Susanna (Old Greek)'], ['056', 'Daniel (Old Greek)'], ['058', 'Bel and the Dragon (Old Greek)'],
  ['055', 'Susanna (Theodotion)'], ['057', 'Daniel (Theodotion)'], ['059', 'Bel and the Dragon (Theodotion)']
];

const SKIP = new Set(['note', 'head', 'pb', 'del', 'gap', 'milestone']);
const ROMAN = { i: 1, v: 5, x: 10 };
const romanValue = (s) => {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]];
    total += ROMAN[s[i + 1]] > v ? -v : v;
  }
  return total;
};

// The text of a TEI node: words from <p>/<l>, nothing from the skipped elements, a space at line breaks.
function textOf(node) {
  let out = '';
  for (const child of node.$$ || []) {
    const name = child['#name'];
    if (name === '__text__') out += child._ || '';
    else if (name === 'lb') out += ' ';
    else if (SKIP.has(name)) continue;
    else out += ` ${textOf(child)} `;
  }
  return out;
}

// Greek text never contains Arabic numerals, so digits in it are digitization residue (footnote markers stuck to
// words, Swete's parallel verse numbers in parentheses, stray verse numbers): they are removed. Latin letters mixed
// into Greek words (OCR) cannot be corrected reliably and are left as the source has them.
const GREEK = '\\u0370-\\u03FF\\u1F00-\\u1FFF';
const clean = (s) => s
  .replace(/[¶§\[\]]/g, '')
  .replace(/\(\d+(?:[,\-–]\d+)*[a-z]?\)/g, '')
  .replace(new RegExp(`\\d+(?=[${GREEK}])|(?<=[${GREEK}])\\d+`, 'g'), '')
  .replace(/(^|\s)\d+(?=\s|$)/g, '$1')
  .replace(/\s+/g, ' ')
  .replace(/ ([,.;·:!?])/g, '$1')
  .trim()
  .normalize('NFC');

// One <div type="edition"> -> { chapters: [[verse text, ...], ...], notes }
function convertEdition(edition, label) {
  const notes = [];
  const numbered = new Map(); // chapter number -> Map(verse number -> text)
  const extras = [];          // Map(verse number -> text) for non-numeric chapter labels, in document order

  const addVerse = (verses, labelText, text) => {
    const m = /^(\d+)/.exec(labelText);
    if (!m) {
      notes.push(`${label}: verse label "${labelText}" has no number; appended to the previous verse`);
      const last = [...verses.keys()].pop();
      if (last !== undefined) verses.set(last, `${verses.get(last)} ${text}`.trim());
      return;
    }
    const n = Number(m[1]);
    verses.set(n, verses.has(n) ? `${verses.get(n)} ${text}`.trim() : text);
  };

  const readChapter = (chapterNode, chapterLabel) => {
    let verses;
    if (/^\d+$/.test(chapterLabel)) {
      if (!numbered.has(Number(chapterLabel))) numbered.set(Number(chapterLabel), new Map());
      verses = numbered.get(Number(chapterLabel));
    } else {
      const roman = /^([ivx]+)([a-z]?)$/.exec(chapterLabel);
      if (roman && (roman[2] === '' || roman[2] === 'a') && !numbered.has(romanValue(roman[1]))) {
        numbered.set(romanValue(roman[1]), new Map());
        verses = numbered.get(romanValue(roman[1]));
      } else {
        verses = new Map();
        extras.push(verses);
        notes.push(`${label}: chapter "${chapterLabel}" kept as an extra chapter at the end`);
      }
    }
    let pending = '';
    for (const child of chapterNode.$$ || []) {
      if (child['#name'] === 'div' && child.$ && child.$.subtype === 'verse') {
        const text = clean(textOf(child));
        if (!/^\d/.test(String(child.$.n)) && verses.size === 0) {
          // a superscription div ("head", Isaiah 32) before verse 1: held and prepended to verse 1
          if (text) pending = `${pending} ${text}`.trim();
        } else if (verses.size === 0 && pending) {
          addVerse(verses, child.$.n, `${pending} ${text}`.trim());
          pending = '';
        } else {
          addVerse(verses, child.$.n, text);
        }
      } else if (['p', 'l', 'lg'].includes(child['#name'])) {
        const text = clean(textOf(child));
        if (text) pending = `${pending} ${text}`.trim();
      }
    }
    if (pending) {
      if (verses.size === 0) {
        verses.set(1, pending); // a chapter that is only paragraphs (Sirach's prologue)
        notes.push(`${label}: chapter "${chapterLabel}" has no verse divisions; its text is verse 1`);
      } else {
        const last = Math.max(...verses.keys());
        verses.set(last, `${verses.get(last)} ${pending}`.trim());
        notes.push(`${label}: text after the last verse of chapter "${chapterLabel}" appended to verse ${last}`);
      }
    }
  };

  const chapterDivs = (edition.$$ || []).filter((c) => c['#name'] === 'div' && c.$ && c.$.subtype === 'chapter');
  if (chapterDivs.length) {
    for (const c of chapterDivs) readChapter(c, String(c.$.n || '').trim());
  } else {
    readChapter(edition, '1'); // a book with no chapters: its verses sit directly under the edition
  }
  const toArray = (verses) => {
    const max = verses.size ? Math.max(...verses.keys()) : 0;
    const out = [];
    for (let v = 1; v <= max; v++) out.push(verses.get(v) || '');
    return out;
  };
  const maxChapter = numbered.size ? Math.max(...numbered.keys()) : 0;
  const chapters = [];
  for (let c = 1; c <= maxChapter; c++) chapters.push(numbered.has(c) ? toArray(numbered.get(c)) : []);
  for (const verses of extras) chapters.push(toArray(verses));
  return { chapters, notes };
}

async function convertFile(file, label) {
  const doc = await new xml2js.Parser({
    explicitChildren: true, preserveChildrenOrder: true, charsAsChildren: true, explicitArray: true, trim: false, normalize: false
  }).parseStringPromise(fs.readFileSync(file, 'utf8'));
  const tei = doc.TEI;
  const text = (tei.$$ || []).find((c) => c['#name'] === 'text');
  const body = text && (text.$$ || []).find((c) => c['#name'] === 'body');
  const edition = body && (body.$$ || []).find((c) => c['#name'] === 'div');
  if (!edition) throw new Error(`${label}: no edition div in ${path.basename(file)}`);
  const licence = JSON.stringify(tei).match(/creativecommons\.org\/licenses\/by-sa\/4\.0/);
  if (!licence) throw new Error(`${label}: ${path.basename(file)} does not state the CC BY-SA 4.0 licence; check before redistributing`);
  return convertEdition(edition, label);
}

(async () => {
  const books = [];
  const missing = [];
  const notes = [];
  for (const [id, name] of BOOKS) {
    const file = path.join(dir, `tlg${id}`, `tlg0527.tlg${id}.1st1K-grc1.xml`);
    if (!fs.existsSync(file)) {
      missing.push(name);
      continue;
    }
    const { chapters, notes: bookNotes } = await convertFile(file, name);
    notes.push(...bookNotes);
    books.push({ num: books.length + 1, name, chapters });
  }
  if (!books.length) throw new Error(`No tlg0527 files found in ${dir}`);

  const { xml, verseCount, emptyCount } = buildZefaniaXml({
    title: 'Septuagint (Swete, Greek)',
    creator: 'Henry Barclay Swete (editor)',
    description: 'The Septuagint in Greek: Henry Barclay Swete\'s edition, The Old Testament in Greek (Cambridge, 1901-1930), digitized by the Open Greek and Latin project. '
      + 'Verse numbers follow Swete: numbers he skips are empty, and his extra readings (verses labeled 35a, 24b ...) are appended to the verse they follow. '
      + 'Psalms use the Septuagint numbering (Psalm 22 here is Psalm 23 in English Bibles). Joshua and Judges are the B (Vaticanus) text. '
      + 'Ecclesiastes is not in the source. The text was digitized from print, so some typographical errors remain (for example Latin letters inside Greek words).',
    publisher: 'Open Greek and Latin (University of Leipzig)',
    contributors: 'Open Greek and Latin project; Gregory R. Crane; Digital Divide Data (corrected and encoded the text); Matt Munson; Annette Gessner; Thibault Clerice; Bruce Robertson; Greta Franzini; Frederik Baumgardt; Simona Stoyanova; Harvard College Library',
    date: new Date().toISOString().slice(0, 10),
    identifier: 'lxx-swete',
    source: 'https://github.com/OpenGreekAndLatin/First1KGreek/tree/master/data/tlg0527',
    language: 'GRC',
    rights: 'CC BY-SA 4.0 - https://creativecommons.org/licenses/by-sa/4.0/ - Open Greek and Latin project, University of Leipzig. Swete\'s 1901-1930 printed edition is in the public domain.'
  }, books);

  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'LXX_Swete.xml');
  fs.writeFileSync(outFile, xml, 'utf8');
  console.log(`✓ LXX_Swete: ${books.length} books, ${verseCount} verses (${emptyCount} empty) → ${outFile}`);
  if (missing.length) console.warn(`  ⚠️ not found in ${dir}: ${missing.join(', ')}`);
  console.log(`  ${notes.length} notes`);
  notes.slice(0, 25).forEach((n) => console.warn(`  · ${n}`));
  if (notes.length > 25) console.warn(`  …and ${notes.length - 25} more`);
})().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
