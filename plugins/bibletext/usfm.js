// plugins/bibletext/usfm.js  (pure Node, no Electron; shared by the converters and the runtime installer)
//
// USFM -> verse text -> Zefania XMLBIBLE, the one copy of that logic.
// Callers: import-ult.js and import-bsb.js (developer CLIs), bibleDownloader.js (the NET download).
//
//   BOOKS                      [{ code, num, name }] for the 66 books; num is the canonical 1-66, name matches the other modules
//   bookForUsfm(usfm)          the BOOKS entry for a file's \id line, or null (front matter, unknown code)
//   parseUsfmBook(usfm, label) -> { chapters: [[verse text, ...], ...], notes: [...] }
//   buildZefaniaXml(info, books) -> { xml, verseCount, emptyCount }   books: [{ num, name, chapters }]
//
// Handles both plain USFM (eBible: \w word|strong="H1"\w*, nested \+w) and the word-aligned unfoldingWord
// files (\zaln-s ... \zaln-e). Only the words are kept. Dropped: footnotes and cross references (\f \x),
// section headings and references (\s \sr \r \ms \mt \mr \cl \rem), acrostic labels (\qa), speaker labels (\sp),
// paragraph/poetry markers (our format has no place for them). \nd (name of God) is upper-cased, so
// "Lord" marked \nd reads LORD. A psalm title (\d, before verse 1) is prepended to verse 1 like the
// BSB/NKJV/NASB/ESV modules, with a period added when the title has none.
// localbiblemanager.js maps verses by position, not by number, so:
//   - a verse range (\v 3-4) puts the text in the first verse and leaves the rest empty;
//   - a verse missing from the source stays as an empty verse (reported in `notes`);
//   - a chapter or verse out of sequence throws.

const BOOK_LIST = [
  ['GEN', 'Genesis'], ['EXO', 'Exodus'], ['LEV', 'Leviticus'], ['NUM', 'Numbers'], ['DEU', 'Deuteronomy'],
  ['JOS', 'Joshua'], ['JDG', 'Judges'], ['RUT', 'Ruth'], ['1SA', '1 Samuel'], ['2SA', '2 Samuel'],
  ['1KI', '1 Kings'], ['2KI', '2 Kings'], ['1CH', '1 Chronicles'], ['2CH', '2 Chronicles'], ['EZR', 'Ezra'],
  ['NEH', 'Nehemiah'], ['EST', 'Esther'], ['JOB', 'Job'], ['PSA', 'Psalms'], ['PRO', 'Proverbs'],
  ['ECC', 'Ecclesiastes'], ['SNG', 'Song of Solomon'], ['ISA', 'Isaiah'], ['JER', 'Jeremiah'], ['LAM', 'Lamentations'],
  ['EZK', 'Ezekiel'], ['DAN', 'Daniel'], ['HOS', 'Hosea'], ['JOL', 'Joel'], ['AMO', 'Amos'],
  ['OBA', 'Obadiah'], ['JON', 'Jonah'], ['MIC', 'Micah'], ['NAM', 'Nahum'], ['HAB', 'Habakkuk'],
  ['ZEP', 'Zephaniah'], ['HAG', 'Haggai'], ['ZEC', 'Zechariah'], ['MAL', 'Malachi'], ['MAT', 'Matthew'],
  ['MRK', 'Mark'], ['LUK', 'Luke'], ['JHN', 'John'], ['ACT', 'Acts'], ['ROM', 'Romans'],
  ['1CO', '1 Corinthians'], ['2CO', '2 Corinthians'], ['GAL', 'Galatians'], ['EPH', 'Ephesians'], ['PHP', 'Philippians'],
  ['COL', 'Colossians'], ['1TH', '1 Thessalonians'], ['2TH', '2 Thessalonians'], ['1TI', '1 Timothy'], ['2TI', '2 Timothy'],
  ['TIT', 'Titus'], ['PHM', 'Philemon'], ['HEB', 'Hebrews'], ['JAS', 'James'], ['1PE', '1 Peter'],
  ['2PE', '2 Peter'], ['1JN', '1 John'], ['2JN', '2 John'], ['3JN', '3 John'], ['JUD', 'Jude'], ['REV', 'Revelation']
];
const BOOKS = BOOK_LIST.map(([code, name], i) => ({ code, num: i + 1, name }));
const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));

function bookForUsfm(usfm) {
  const m = /^\\id\s+([A-Z0-9]{3})\b/m.exec(String(usfm).replace(/^﻿/, ''));
  return (m && BOOK_BY_CODE.get(m[1])) || null;
}

const escapeXml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Any remaining character-style or paragraph marker: \q1, \p, \it, \+bd, \qs*, ...
const ANY_MARKER = /\\\+?[a-z]+\d?(?:\*\*?)?/g; // eBible writes some closers as \qt**

function parseUsfmBook(usfm, label) {
  const notes = [];
  const start = usfm.search(/^\\c\s+\d+/m);
  if (start < 0) throw new Error(`${label}: no chapters found`);
  const body = usfm.slice(start).replace(/\r\n?/g, '\n')
    .replace(/\\(f|fe|x)\s[\s\S]*?\\\1\*/g, '')                    // footnotes, cross references
    .replace(/^\\sp\b[\s\S]*?(?=^\\(?!\+?w\s|zaln))/gm, '')         // speaker label, runs until the next non-word marker
    .replace(/^\\(?:ts\\\*|s\d?|sr|r|mt\d?|ms\d?|mr|cl|qa|b|rem)(?=\s|$).*$/gm, '') // headings, references, labels, blank lines
    .replace(/\\ts\\\*/g, '')
    .replace(/\\zaln-s\s\|[^\\]*\\\*/g, '')                          // alignment start (unfoldingWord)
    .replace(/\\zaln-e\\\*/g, '')                                   // alignment end
    .replace(/\|[^\\|]*(?=\\\+?w\*)/g, '')                          // \w word|attributes\w*  ->  \w word\w*
    .replace(/\\\+?w\s+([^\\]*?)\\\+?w\*/g, '$1')                    // \w word\w* and nested \+w word\+w*
    .replace(/\\nd\s([\s\S]*?)\\nd\*/g, (_m, s) => s.replace(ANY_MARKER, '').toUpperCase())
    .replace(/[{}]/g, '');                                          // non-contiguous alignment groups

  const chapters = [];
  let chapter = null;
  let title = '';
  let target = null; // 'title' or 'verse'
  let verseIdx = -1;

  // A marker becomes a space, so tidy what that leaves next to punctuation and quotes. A stray * is source damage
  // (eBible NET has a few), never real text.
  const clean = (s) => s.replace(ANY_MARKER, ' ').replace(/\*/g, '').replace(/\s+/g, ' ').replace(/ ([,.;:!?”’])/g, '$1').replace(/([“‘]) /g, '$1').trim();
  const append = (arr, i, text) => {
    if (text) arr[i] = arr[i] ? `${arr[i]} ${text}` : text;
  };

  const re = /\\c\s+(\d+)|\\v\s+(\d+)(?:-(\d+))?|\\d(?=\s)/g;
  let m;
  let last = 0;
  const flush = (end) => {
    const text = clean(body.slice(last, end));
    if (!text) return;
    if (!chapter) notes.push(`${label}: text before first chapter: ${text.slice(0, 40)}`);
    else if (target === 'title') title = title ? `${title} ${text}` : text;
    else if (target === 'verse') append(chapter, verseIdx, text);
    else notes.push(`${label} ${chapters.length}: text before any verse: ${text.slice(0, 40)}`);
  };

  while ((m = re.exec(body))) {
    flush(m.index);
    last = re.lastIndex;
    if (m[1]) {
      const n = Number(m[1]);
      if (n !== chapters.length + 1) throw new Error(`${label}: chapter ${n} out of sequence (expected ${chapters.length + 1})`);
      chapter = [];
      chapters.push(chapter);
      title = '';
      target = null;
      verseIdx = -1;
    } else if (m[2]) {
      const v = Number(m[2]);
      const lastV = m[3] ? Number(m[3]) : v;
      if (v < chapter.length + 1) throw new Error(`${label} ${chapters.length}:${v}: verse out of sequence (expected ${chapter.length + 1})`);
      while (chapter.length < v - 1) {
        notes.push(`${label} ${chapters.length}:${chapter.length + 1}: verse missing from source, left empty`);
        chapter.push('');
      }
      verseIdx = chapter.length;
      chapter.push('');
      if (title && verseIdx === 0) {
        chapter[0] = /[.!?:;,”’)\]]$/.test(title) ? title : `${title}.`; // some titles have no end punctuation
        title = '';
      }
      for (let x = v + 1; x <= lastV; x++) chapter.push('');
      if (lastV > v) notes.push(`${label} ${chapters.length}:${v}-${lastV}: verse range, text kept in ${v}`);
      target = 'verse';
    } else {
      // \d: a psalm title. Before verse 1 it is held and prepended to verse 1.
      target = verseIdx < 0 ? 'title' : 'verse';
    }
  }
  flush(body.length);
  if (title) notes.push(`${label} ${chapters.length}: title with no verse 1: ${title.slice(0, 40)}`);

  return { chapters, notes };
}

// info: { title, creator, subject?, description, publisher, contributors?, date, identifier, source, language, rights }
// books: [{ num, name, chapters: [[verse text, ...], ...] }]
function buildZefaniaXml(info, books) {
  let body = '';
  let verseCount = 0;
  let emptyCount = 0;
  for (const book of books) {
    body += `  <BIBLEBOOK bnumber="${book.num}" bname="${escapeXml(book.name)}">\n`;
    book.chapters.forEach((verses, c) => {
      body += `    <CHAPTER cnumber="${c + 1}">\n`;
      verses.forEach((text, v) => {
        body += `      <VERS vnumber="${v + 1}">${escapeXml(text)}</VERS>\n`;
        verseCount++;
        if (!text) emptyCount++;
      });
      body += '    </CHAPTER>\n';
    });
    body += '  </BIBLEBOOK>\n';
  }

  const header = `<?xml version="1.0" encoding="utf-8"?>
<XMLBIBLE version="2.0.1.18" status="v" biblename="${escapeXml(info.title)}" type="x-bible" revision="0">
  <INFORMATION>
    <title>${escapeXml(info.title)}</title>
    <creator>${escapeXml(info.creator)}</creator>
    <subject>${escapeXml(info.subject || 'The Holy Bible')}</subject>
    <description>${escapeXml(info.description)}</description>
    <publisher>${escapeXml(info.publisher)}</publisher>
    ${info.contributors ? `<contributors>${escapeXml(info.contributors)}</contributors>` : '<contributors />'}
    <date>${escapeXml(info.date)}</date>
    <type>Bible</type>
    <format>Zefania XML Bible Markup Language</format>
    <identifier>${escapeXml(info.identifier)}</identifier>
    <source>${escapeXml(info.source)}</source>
    <language>${escapeXml(info.language)}</language>
    <coverage>provide the Bible to the nations of the world</coverage>
    <rights>${escapeXml(info.rights)}</rights>
  </INFORMATION>
`;
  return { xml: header + body + '</XMLBIBLE>\n', verseCount, emptyCount };
}

module.exports = { BOOKS, bookForUsfm, parseUsfmBook, buildZefaniaXml };
