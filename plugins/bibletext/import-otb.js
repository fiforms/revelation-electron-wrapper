// plugins/bibletext/import-otb.js  (one-off developer CLI, not loaded by the app)
// Converts the Open Translation Bible (https://github.com/OpenTranslationBible/open-bible,
// CC BY-SA 4.0) per-chapter JSON files into Zefania XMLBIBLE files that
// localbiblemanager.js can load from ./bibles/ (it builds the .json cache itself).
//
// Usage:
//   node import-otb.js <path-to-open-bible-checkout> [--lang fr-FR,de-DE] [--out ./bibles]
//
// The checkout needs only lang/ (the PDFs make a full clone ~500 MB), e.g.:
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/OpenTranslationBible/open-bible
//   cd open-bible && git sparse-checkout set lang
//
// Input layout: lang/<code>/NN.<Book name>/json/<slug>-CCC.json, each file
//   { book, chapter, verses: [ { verse?: n, text: [lines] } ] }
// Lines are joined with a space; the markdown quote marker ("> ") and "---" stanza breaks
// are removed. An unnumbered entry before verse 1 (a psalm title) is prepended to verse 1,
// like the NKJV/NASB/ESV modules, so verse numbers stay aligned. Other unnumbered entries
// (Psalm 119 letter headings, manuscript notes) are skipped.
// Stray assistant text left in the source (a "---" followed by a "[...]" note, as in
// Psalm 78:16 of every language) is cut off and reported.
// Output: OTB_<code>.xml with identifier "otb-<code>" (must be unique across ./bibles/).
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const langFilter = (opt('--lang') || '').split(',').map(s => s.trim()).filter(Boolean);
const outDir = path.resolve(opt('--out') || path.join(__dirname, 'bibles'));
const root = args[0];

if (!root) {
  console.error('Usage: node import-otb.js <open-bible checkout> [--lang fr-FR,de-DE] [--out dir]');
  process.exit(1);
}
const langRoot = fs.existsSync(path.join(root, 'lang')) ? path.join(root, 'lang') : root;

const escapeXml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STRAY_NOTE = /markdown|would you like me to/i;

// Returns { text, strayNote } for one verse's lines.
function verseText(lines) {
  let strayNote = null;
  const cut = lines.findIndex((l, i) => i > 0 && String(lines[i - 1]).trim() === '---' && /^\s*\[/.test(l));
  if (cut > 0) {
    strayNote = lines.slice(cut).join(' ');
    lines = lines.slice(0, cut);
  }
  const text = lines
    .map(l => String(l).replace(/^\s*>\s?/, '').trim())
    .filter(l => l && l !== '---')
    .join(' ')
    .replace(/\s+/g, ' ');
  return { text, strayNote };
}

function convertLanguage(code) {
  const dir = path.join(langRoot, code);
  const bookDirs = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d+\./.test(e.name))
    .map(e => e.name)
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  if (!bookDirs.length) throw new Error('no book folders found');

  const warnings = [];
  let verseCount = 0;
  let xml = '';

  for (const bookDir of bookDirs) {
    const bnumber = parseInt(bookDir, 10);
    const bname = bookDir.replace(/^\d+\./, '');
    const jsonDir = path.join(dir, bookDir, 'json');
    const chapters = fs.readdirSync(jsonDir)
      .filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(fs.readFileSync(path.join(jsonDir, f), 'utf8')))
      .sort((a, b) => a.chapter - b.chapter);

    xml += `  <BIBLEBOOK bnumber="${bnumber}" bname="${escapeXml(bname)}">\n`;
    for (const ch of chapters) {
      xml += `    <CHAPTER cnumber="${ch.chapter}">\n`;
      let title = '';
      let sawVerse = false;
      for (const v of ch.verses) {
        if (!Number.isInteger(v.verse)) {
          if (!sawVerse) title = verseText(v.text || []).text;
          continue;
        }
        sawVerse = true;
        const where = `${bname} ${ch.chapter}:${v.verse}`;
        let { text, strayNote } = verseText(v.text || []);
        if (strayNote) warnings.push(`${where}: removed stray note: ${strayNote.slice(0, 80)}`);
        if (STRAY_NOTE.test(text)) warnings.push(`${where}: text still looks like an assistant note, check by hand`);
        if (title) {
          text = `${title} ${text}`;
          title = '';
        }
        if (!text) warnings.push(`${where}: empty verse`);
        xml += `      <VERS vnumber="${v.verse}">${escapeXml(text)}</VERS>\n`;
        verseCount++;
      }
      xml += '    </CHAPTER>\n';
    }
    xml += '  </BIBLEBOOK>\n';
  }

  let langName = code;
  try { langName = new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch {}
  const title = `Open Translation Bible (${langName})`;
  const header = `<?xml version="1.0" encoding="utf-8"?>
<XMLBIBLE version="2.0.1.18" status="v" biblename="${escapeXml(title)}" type="x-bible" revision="0">
  <INFORMATION>
    <title>${escapeXml(title)}</title>
    <creator>Open Translation Bible</creator>
    <subject>The Holy Bible</subject>
    <description>Open Translation Bible, ${escapeXml(langName)} edition.</description>
    <publisher>Open Translation Bible (openbible.uk)</publisher>
    <contributors />
    <date>${new Date().toISOString().slice(0, 10)}</date>
    <type>Bible</type>
    <format>Zefania XML Bible Markup Language</format>
    <identifier>otb-${code.toLowerCase()}</identifier>
    <source>https://github.com/OpenTranslationBible/open-bible</source>
    <language>${escapeXml(code)}</language>
    <coverage>provide the Bible to the nations of the world</coverage>
    <rights>CC BY-SA 4.0 - https://creativecommons.org/licenses/by-sa/4.0/</rights>
  </INFORMATION>
`;
  const outFile = path.join(outDir, `OTB_${code}.xml`);
  fs.writeFileSync(outFile, header + xml + '</XMLBIBLE>\n', 'utf8');
  return { outFile, books: bookDirs.length, verseCount, warnings };
}

fs.mkdirSync(outDir, { recursive: true });
const codes = fs.readdirSync(langRoot, { withFileTypes: true })
  .filter(e => e.isDirectory() && /^[a-z]{2,3}-[A-Z]{2}$/.test(e.name))
  .map(e => e.name)
  .filter(c => !langFilter.length || langFilter.includes(c));

if (!codes.length) {
  console.error(`No matching language folders in ${langRoot}`);
  process.exit(1);
}

for (const code of codes) {
  try {
    const r = convertLanguage(code);
    console.log(`✓ ${code}: ${r.books} books, ${r.verseCount} verses → ${r.outFile}`);
    r.warnings.slice(0, 10).forEach(w => console.warn(`  ⚠️ ${w}`));
    if (r.warnings.length > 10) console.warn(`  ⚠️ …and ${r.warnings.length - 10} more`);
  } catch (e) {
    console.warn(`⚠️ ${code}: ${e.message}`);
  }
}
