// make-manifest.js  (developer CLI: run it inside the folder you upload to the Bible CDN)
//
// Scans the current directory for Bible source files (*.xml or *.xml.gz), computes sha256 hashes and writes
// manifest.json, which the app's Bible downloads read (bibleDownloader.js). Each entry is
//   { name, sha256, size, title, language, group }
// where title and language come from the file's own <INFORMATION> block, size is the bytes of the file listed
// (the .gz when both exist), and group is the id the app shows as a checkbox ("english", "spanish", "ancient",
// "other"; see ../bibleGroups.js). Older apps read only name and sha256, so the extra fields are safe.
// If both foo.xml and foo.xml.gz exist, the .xml.gz is listed (smaller download); the hash is of the listed file.
//
// Overrides: an optional groups.json in the same folder maps a file's base name (no .xml/.xml.gz) or its
// <identifier> to a group id, e.g. { "OTB_he-IL": "ancient", "pt-study": "portuguese" }. A new group id appears in
// the app by itself.
//
// Usage:  cd <upload folder> && node <path to>/make-manifest.js
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const path = require('path');
const { groupForLanguage } = require('../bibleGroups');

const BIBLE_FILE = /\.xml(?:\.gz)?$/i;

function sha256(filepath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filepath)).digest('hex');
}

// title / language / identifier from the <INFORMATION> block ('' when absent).
function readInfo(filepath) {
  let text = fs.readFileSync(filepath);
  if (/\.gz$/i.test(filepath)) text = zlib.gunzipSync(text);
  text = text.toString('utf8');
  const end = text.indexOf('</INFORMATION>');
  const head = end > 0 ? text.slice(0, end) : text.slice(0, 20000);
  const field = (tag) => {
    const m = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`, 'i').exec(head);
    return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') : '';
  };
  return { title: field('title'), language: field('language'), identifier: field('identifier') };
}

function loadOverrides(dir) {
  const file = path.join(dir, 'groups.json');
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('groups.json must be an object.');
  return parsed;
}

function buildManifest(dir) {
  const sourceFiles = fs.readdirSync(dir).filter((f) => BIBLE_FILE.test(f));
  if (sourceFiles.length === 0) return null;

  const byBaseName = new Map();
  for (const name of sourceFiles) {
    const base = name.replace(BIBLE_FILE, '');
    const existing = byBaseName.get(base);
    if (!existing || (!/\.gz$/i.test(existing) && /\.gz$/i.test(name))) byBaseName.set(base, name);
  }

  const overrides = loadOverrides(dir);
  const files = Array.from(byBaseName.values()).sort((a, b) => a.localeCompare(b)).map((name) => {
    const full = path.join(dir, name);
    const info = readInfo(full);
    const base = name.replace(BIBLE_FILE, '');
    const group = String(overrides[base] || overrides[info.identifier] || groupForLanguage(info.language));
    return { name, sha256: sha256(full), size: fs.statSync(full).size, title: info.title, language: info.language, group };
  });
  return { generated: new Date().toISOString(), files };
}

module.exports = { buildManifest, readInfo };

if (require.main === module) {
  const DIR = process.cwd();
  console.log('📘 Building manifest from:', DIR);
  const manifest = buildManifest(DIR);
  if (!manifest) {
    console.warn('⚠️ No Bible source files found (.xml or .xml.gz).');
    process.exit(0);
  }
  fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const counts = {};
  for (const f of manifest.files) counts[f.group] = (counts[f.group] || 0) + 1;
  console.log(`✅ Wrote ${path.join(DIR, 'manifest.json')} (${manifest.files.length} entries: ${Object.entries(counts).map(([g, n]) => `${g} ${n}`).join(', ')})`);
}
