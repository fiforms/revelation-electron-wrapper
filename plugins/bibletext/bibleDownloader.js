// plugins/bibletext/bibleDownloader.js  (main process, pure Node: no Electron, callers pass the directories)
//
// Purpose: the app ships only the KJV; the other translations are downloaded on request into the user's
// own Bible folder (<userData>/bibles, see plugin.js userBiblesDir). Two offers:
//   "collection"  the Bibles in the pastordaniel.net manifest (the same list fetch-bibles.js builds from), by
//                 language group (bibleGroups.js; the manifest tags each file with a group). Each file is verified
//                 against the manifest's sha256 before it replaces anything.
//   "net"         the NET Bible, downloaded from eBible.org's USFM zip and converted here, on this machine, to
//                 NET.xml (usfm.js). Nothing is redistributed: the text goes from the publisher's site to the
//                 user's disk. The NET terms (https://netbible.com/copyright/): free to copy for others only
//                 when given away, never bundled with anything sold, and quotations end with "(NET)"; the
//                 file's <rights> says so.
// Exports: MANIFEST_URL, NET_USFM_URL, OFFERS, getCollectionGroups, installCollection, installNet, install(id, opts),
//   getStatus(destDir), getProgress(), listBibleBaseNames(dir), bundledBiblesDir(pluginFolder), userBiblesDir(userData),
//   defaultGroups(uiLanguage) (re-exported from bibleGroups.js so lib/ never requires a plugin file at load time).
// Callers: plugin.js (api 'get-bible-downloads' / 'install-bible-download' / 'get-download-progress', the
//   Bible manager page bibles.html), lib/firstRunBibles.js (first-run setup, before any plugin is loaded),
//   fetch-bibles.js (the build-time fetch).
// Gotchas: one install runs at a time (a second call rejects); progress is { received, total, label, phase }
//   where received/total count files for the collection and are absent while the NET zip downloads;
//   localbiblemanager.js picks new files up on its next loadBibles() (plugin.js reloads after an install).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const unzipper = require('unzipper');
const { downloadToFile, fetchJson } = require(path.join(__dirname, '..', '..', 'lib', 'httpUtil'));
const { isSafeBasename } = require(path.join(__dirname, '..', '..', 'lib', 'pathSafety'));
const { BOOKS, bookForUsfm, parseUsfmBook, buildZefaniaXml } = require('./usfm');
const { labelForGroup, orderGroups, defaultGroups } = require('./bibleGroups');

const MANIFEST_URL = 'https://www.pastordaniel.net/bigmedia/bibles/manifest.json';
const NET_USFM_URL = 'https://ebible.org/Scriptures/engnet_usfm.zip';
const OFFERS = ['collection', 'net'];

const MB = 1024 * 1024;
const MAX_BIBLE_BYTES = 300 * MB;   // one Bible module; the largest is far smaller
const MAX_NET_ZIP_BYTES = 50 * MB;
const MAX_USFM_BYTES = 20 * MB;     // per book file inside the NET zip
const COLLECTION_MARKER = 'collection-installed.json';
const NET_FILE = 'NET.xml';
const NET_MIN_VERSES = 31000;      // the NET has 31,102; fewer means a truncated or wrong download
const NET_RIGHTS = 'NET Bible® copyright ©1996, 2019 by Biblical Studies Press, L.L.C. https://netbible.com/copyright/ - used with permission. Quotations must be followed by (NET).';

const BIBLE_FILE = /\.xml(?:\.gz)?$/i;
const baseName = (name) => name.replace(BIBLE_FILE, '').toLowerCase();

let running = null; // id of the install in progress
let progress = { id: null, phase: 'idle' };

function setProgress(patch, onProgress) {
  progress = { ...progress, ...patch };
  if (typeof onProgress === 'function') onProgress({ ...progress });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

// Where the app's own Bibles live and where downloads go (the user's folder is always writable).
const bundledBiblesDir = (pluginFolder) => path.join(pluginFolder, 'bibletext', 'bibles');
const userBiblesDir = (userDataPath) => path.join(userDataPath, 'bibles');

// Base names (no .xml/.xml.gz, lower case) of the Bibles in a folder, for "already have this one".
function listBibleBaseNames(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => BIBLE_FILE.test(f)).map(baseName);
  } catch {
    return [];
  }
}

// The manifest's usable entries: a safe .xml/.xml.gz name; a missing group (an older manifest) counts as "other".
function manifestEntries(manifest) {
  const entries = Array.isArray(manifest && manifest.files) ? manifest.files : [];
  return entries.map((e) => ({ ...(e || {}), group: String((e && e.group) || 'other') }));
}

// Accepts undefined (every group) or an array of group ids; anything else is refused.
function normalizeGroups(groups) {
  if (groups === undefined || groups === null) return null;
  if (!Array.isArray(groups)) throw new Error('groups must be a list of group ids.');
  const ids = groups.filter((g) => typeof g === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(g));
  if (!ids.length) throw new Error('Choose at least one group of Bibles.');
  return new Set(ids);
}

// The groups the manifest offers, for the checkboxes: [{ id, label, count, bytes, titles }] in display order.
// Files the app already bundles (skipNames) are left out of the counts.
async function getCollectionGroups({ manifestUrl = MANIFEST_URL, skipNames = [], httpsOnly = true } = {}) {
  const skip = new Set(skipNames.map((n) => String(n).toLowerCase()));
  const byId = new Map();
  for (const e of manifestEntries(await fetchJson(manifestUrl, { httpsOnly }))) {
    if (!isSafeBasename(e.name) || !BIBLE_FILE.test(e.name) || skip.has(baseName(e.name))) continue;
    if (!byId.has(e.group)) byId.set(e.group, { id: e.group, label: labelForGroup(e.group), count: 0, bytes: 0, titles: [] });
    const g = byId.get(e.group);
    g.count += 1;
    g.bytes += Number(e.size) || 0;
    g.titles.push(String(e.title || baseName(e.name)));
  }
  return orderGroups([...byId.keys()]).map((id) => byId.get(id));
}

function readMarker(destDir) {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(destDir, COLLECTION_MARKER), 'utf8'));
    return { groups: Array.isArray(marker.groups) ? marker.groups.filter((g) => typeof g === 'string') : [] };
  } catch {
    return { groups: [] };
  }
}

// Downloads the Bibles in the manifest that are not already present (or whose hash differs).
// skipNames: base names to leave alone (the Bibles bundled with the app).
// groups: group ids to download (see getCollectionGroups); omitted means every group.
// Resolves { downloaded, upToDate, skipped, failed: [{ name, error }] }; a failed file never stops the others.
async function installCollection({ destDir, manifestUrl = MANIFEST_URL, skipNames = [], groups, onProgress, log = () => {}, httpsOnly = true } = {}) {
  if (!destDir) throw new Error('installCollection needs destDir');
  const wanted = normalizeGroups(groups);
  fs.mkdirSync(destDir, { recursive: true });
  const skip = new Set(skipNames.map((n) => String(n).toLowerCase()));

  const manifest = await fetchJson(manifestUrl, { httpsOnly });
  const all = manifestEntries(manifest);
  if (!all.length) throw new Error('The Bible manifest lists no files.');
  const entries = wanted ? all.filter((e) => wanted.has(e.group)) : all;
  if (!entries.length) throw new Error('The Bible manifest has no files in the chosen groups.');

  const result = { downloaded: [], upToDate: [], skipped: [], failed: [] };
  for (let i = 0; i < entries.length; i++) {
    const { name, sha256 } = entries[i] || {};
    setProgress({ received: i, total: entries.length, label: String(name || '') }, onProgress);
    if (!isSafeBasename(name) || !BIBLE_FILE.test(name)) {
      result.failed.push({ name: String(name), error: 'unsafe or unexpected file name in manifest' });
      continue;
    }
    if (skip.has(baseName(name))) {
      result.skipped.push(name);
      continue;
    }

    const dest = path.join(destDir, name);
    const part = `${dest}.part`;
    try {
      if (fs.existsSync(dest) && sha256 && (await sha256File(dest)) === String(sha256).toLowerCase()) {
        result.upToDate.push(name);
        log(`✓ ${name} up-to-date`);
        continue;
      }
      log(`⬇️ Downloading ${name}…`);
      fs.rmSync(part, { force: true });
      await downloadToFile(new URL(name, manifestUrl).toString(), part, { httpsOnly, maxBytes: MAX_BIBLE_BYTES });
      if (sha256 && (await sha256File(part)) !== String(sha256).toLowerCase()) {
        throw new Error('hash mismatch (download is corrupt or the manifest is out of date)');
      }
      fs.renameSync(part, dest);
      result.downloaded.push(name);
      log(`✓ Saved ${name}`);
    } catch (err) {
      fs.rmSync(part, { force: true });
      result.failed.push({ name, error: err.message });
      log(`⚠️ Failed: ${name}: ${err.message}`);
    }
  }
  setProgress({ received: entries.length, total: entries.length, label: '' }, onProgress);

  if (!result.failed.length) {
    const installedGroups = new Set(readMarker(destDir).groups);
    for (const e of entries) installedGroups.add(e.group);
    fs.writeFileSync(path.join(destDir, COLLECTION_MARKER), JSON.stringify({
      installedAt: new Date().toISOString(), files: entries.length, groups: orderGroups([...installedGroups])
    }), 'utf8');
  }
  return result;
}

// Downloads the NET USFM zip, converts it and writes <destDir>/NET.xml. Resolves { file, verseCount }.
async function installNet({ destDir, workDir = os.tmpdir(), url = NET_USFM_URL, onProgress, httpsOnly = true, minVerses = NET_MIN_VERSES } = {}) {
  if (!destDir) throw new Error('installNet needs destDir');
  fs.mkdirSync(destDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(workDir, 'revelation-net-'));
  try {
    const zipPath = path.join(tmp, 'net.zip');
    setProgress({ phase: 'downloading', received: undefined, total: undefined, label: 'NET' }, onProgress);
    await downloadToFile(url, zipPath, { httpsOnly, maxBytes: MAX_NET_ZIP_BYTES });

    setProgress({ phase: 'converting', received: 1, total: 1 }, onProgress);
    // Entries are read into memory by name, never extracted to disk, so a hostile path in the zip goes nowhere.
    const directory = await unzipper.Open.file(zipPath);
    const usfmEntries = directory.files.filter((e) =>
      e.type === 'File' && /^[^/\\]+\.usfm$/i.test(e.path) && e.uncompressedSize <= MAX_USFM_BYTES);
    if (!usfmEntries.length || usfmEntries.length > 200) throw new Error('The NET download is not the expected USFM zip.');

    const byNum = new Map();
    for (const entry of usfmEntries) {
      const usfm = (await entry.buffer()).toString('utf8');
      const book = bookForUsfm(usfm);
      if (!book) continue; // front matter
      byNum.set(book.num, { num: book.num, name: book.name, chapters: parseUsfmBook(usfm, book.name).chapters });
    }
    if (byNum.size !== BOOKS.length) {
      throw new Error(`The NET download had ${byNum.size} of ${BOOKS.length} books.`);
    }

    const { xml, verseCount } = buildZefaniaXml({
      title: 'New English Translation',
      creator: 'Biblical Studies Press, L.L.C.',
      description: 'NET Bible® (New English Translation), text without the translators\' notes, converted from eBible.org\'s USFM on this computer.',
      publisher: 'Biblical Studies Press, L.L.C.',
      date: new Date().toISOString().slice(0, 10),
      identifier: 'net',
      source: url,
      language: 'ENG',
      rights: NET_RIGHTS
    }, BOOKS.map((b) => byNum.get(b.num)));
    if (verseCount < minVerses) throw new Error(`The NET download looks incomplete (${verseCount} verses).`);

    const dest = path.join(destDir, NET_FILE);
    fs.writeFileSync(`${dest}.part`, xml, 'utf8');
    fs.renameSync(`${dest}.part`, dest);
    return { file: dest, verseCount };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Runs one offer. Rejects if another is running. opts: destDir (required), skipNames and groups (collection), onProgress,
// log, and for tests manifestUrl / url / httpsOnly / workDir / minVerses.
async function install(id, opts = {}) {
  if (!OFFERS.includes(id)) throw new Error(`Unknown Bible download: ${id}`);
  if (running) throw new Error('A Bible download is already running.');
  running = id;
  progress = { id, phase: 'working' };
  try {
    let result;
    if (id === 'collection') {
      result = await installCollection(opts);
      if (result.failed.length) {
        const first = result.failed[0];
        throw new Error(`${result.failed.length} of the files failed (${first.name}: ${first.error}).`);
      }
    } else {
      result = await installNet(opts);
    }
    setProgress({ phase: 'done', error: undefined }, opts.onProgress);
    return result;
  } catch (err) {
    setProgress({ phase: 'failed', error: err.message }, opts.onProgress);
    throw err;
  } finally {
    running = null;
  }
}

// Snapshot for the UI to poll: which offer is running and how far along it is.
function getProgress() {
  return { ...progress, running };
}

// collection.groups: the group ids downloaded so far (the marker accumulates them across downloads).
function getStatus(destDir) {
  return {
    collection: { installed: fs.existsSync(path.join(destDir, COLLECTION_MARKER)), groups: readMarker(destDir).groups },
    net: { installed: fs.existsSync(path.join(destDir, NET_FILE)) }
  };
}

module.exports = {
  MANIFEST_URL, NET_USFM_URL, OFFERS,
  getCollectionGroups, installCollection, installNet, install, getStatus, getProgress,
  listBibleBaseNames, bundledBiblesDir, userBiblesDir, defaultGroups
};
