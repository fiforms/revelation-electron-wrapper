// Enforcement of the .revel content rules (doc/dev/REVEL_FORMAT.md section 3.1; app behavior in
// doc/dev/REVEL_IMPLEMENTATION.md) and the
// archive reading/writing built on them. No Electron dependency, so it is usable and testable
// on its own.
//
// Rules in short: a .revel file never contains files that can run code, nor archives, compressed
// files or disk images. SVG is sanitized. Writers omit, and readers skip, anything prohibited.
const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream');
const archiver = require('archiver');
const unzipper = require('unzipper');

const PROHIBITED_EXTENSIONS = new Set([
  // Files that can run code
  '.html', '.htm', '.xhtml', '.js', '.mjs', '.cjs', '.sh', '.bat', '.cmd', '.ps1', '.vbs', '.wsf',
  '.exe', '.com', '.scr', '.msi', '.dll', '.so', '.dylib', '.jar', '.app', '.lnk', '.desktop', '.py',
  // Macro-enabled Office files
  '.docm', '.dotm', '.xlsm', '.xlam', '.pptm', '.potm', '.ppsm', '.sldm',
  // Archives, compressed files and disk images. This implementation blocks all of them by
  // extension (REVEL_FORMAT.md section 3.1 lets an implementation block all archives rather
  // than scan them). Document formats that are ZIP containers (.docx, .pptx, .xlsx, .odp, .key,
  // ...) are documents, not archives, and are not listed.
  '.zip', '.tar', '.gz', '.tgz', '.xz', '.txz', '.bz2', '.tbz2', '.7z', '.rar', '.cab', '.iso', '.dmg', '.img'
]);

// Types the spec lists as permitted media and fonts. A file with one of these names whose content
// is an archive is a disguised archive. Other types (.pdf, .docx, .key, unknown) are not sniffed
// for archive content, since many of them are legitimately ZIP containers.
const MEDIA_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.mp4', '.webm', '.mp3', '.ogg', '.opus', '.wav',
  '.m4a', '.aac', '.woff', '.woff2', '.ttf', '.otf'
]);

// Parsed as text by the app, so a signature check on their content is meaningless.
const TEXT_EXTENSIONS = new Set(['.md', '.json', '.css', '.txt', '.yaml', '.yml', '.svg']);

const EXECUTABLE_SIGNATURES = [
  Buffer.from('MZ'),                          // Windows PE
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]),      // ELF
  Buffer.from([0xfe, 0xed, 0xfa, 0xce]),      // Mach-O 32
  Buffer.from([0xfe, 0xed, 0xfa, 0xcf]),      // Mach-O 64
  Buffer.from([0xce, 0xfa, 0xed, 0xfe]),      // Mach-O 32 (little endian)
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),      // Mach-O 64 (little endian)
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]),      // Mach-O universal / Java class
  Buffer.from('#!')                           // script
];
const ARCHIVE_SIGNATURES = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),      // ZIP (and zip-based formats)
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),      // empty ZIP
  Buffer.from([0x1f, 0x8b]),                  // gzip
  Buffer.from('BZh'),                         // bzip2
  Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]), // xz
  Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), // 7z
  Buffer.from('Rar!')                         // RAR
];
const SIGNATURE_BYTES = 8;

const MAX_ENTRIES = 20000;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024; // 8 GiB uncompressed
const MAX_SVG_BYTES = 10 * 1024 * 1024;

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

// "photo.jpg.exe", "a.EXE", and Windows' trailing dot/space tricks ("a.exe.", "a.exe ") all
// resolve to the real final extension.
function finalExtension(name) {
  const base = path.posix.basename(toPosix(name)).replace(/[. ]+$/, '').toLowerCase();
  return path.posix.extname(base);
}

function isProhibitedName(name) {
  return PROHIBITED_EXTENSIONS.has(finalExtension(name));
}

function startsWithAny(head, signatures) {
  if (!head || !head.length) return false;
  return signatures.some((sig) => head.length >= sig.length && head.subarray(0, sig.length).equals(sig));
}

function hasExecutableSignature(head) {
  return startsWithAny(head, EXECUTABLE_SIGNATURES);
}

function hasArchiveSignature(head) {
  return startsWithAny(head, ARCHIVE_SIGNATURES);
}

function isTextName(name) {
  return TEXT_EXTENSIONS.has(finalExtension(name));
}

// Why an entry may not be used, or '' if it is allowed. `head` is the first bytes of its content.
// Unknown types (.pdf, .pptx, .docx, .key, project files) are allowed by name; only executable
// content is refused whatever the name, and archive content under a media name.
function prohibitionReason(name, head) {
  if (isProhibitedName(name)) return 'file type not allowed';
  if (isTextName(name)) return '';
  if (hasExecutableSignature(head)) return 'executable or script content';
  if (MEDIA_EXTENSIONS.has(finalExtension(name)) && hasArchiveSignature(head)) return 'archive content';
  return '';
}

// Files REVELation neither parses nor serves itself: documents, PDFs and other project files that
// a user may later open in another program. These carry the download-origin mark (originMark.js).
function needsOriginMark(name) {
  return !isTextName(name) && !MEDIA_EXTENSIONS.has(finalExtension(name));
}

function isUnsafeEntryName(name) {
  const n = toPosix(name);
  if (!n || n.startsWith('/') || /^[a-zA-Z]:/.test(n)) return true;
  return n.split('/').some((seg) => seg === '..');
}

function hasHiddenSegment(name) {
  return toPosix(name).split('/').some((seg) => seg.startsWith('.'));
}

// --- SVG ---------------------------------------------------------------------------------
const SVG_REMOVE_ELEMENTS = new Set([
  'script', 'foreignobject', 'iframe', 'embed', 'object', 'audio', 'video', 'canvas', 'handler', 'listener'
]);
const SVG_ANIMATION_ELEMENTS = new Set(['set', 'animate', 'animatetransform', 'animatemotion']);
const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif);/i;

function localName(name) {
  const n = String(name || '').toLowerCase();
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
}

function stripExternalCss(css) {
  return String(css)
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)(?!#|data:image\/)[^)]*\1\s*\)/gi, 'none');
}

// Returns { ok, text, removed }. ok is false when the file cannot be made safe (not XML, no <svg>
// root, or too large), in which case the caller drops it.
function sanitizeSvg(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  if (buffer.length > MAX_SVG_BYTES) return { ok: false, text: '', removed: 0 };
  let cheerio;
  try {
    cheerio = require('cheerio');
  } catch {
    return { ok: false, text: '', removed: 0 };
  }
  let $;
  try {
    $ = cheerio.load(buffer.toString('utf8'), { xmlMode: true });
  } catch {
    return { ok: false, text: '', removed: 0 };
  }
  const roots = $.root().children().toArray().filter((n) => n.type === 'tag');
  if (roots.length !== 1 || localName(roots[0].name) !== 'svg') {
    return { ok: false, text: '', removed: 0 };
  }

  let removed = 0;
  // Only the <svg> root is kept. This drops DOCTYPE and entity declarations (XXE, entity
  // expansion), the stray text a DOCTYPE internal subset leaves behind, and processing
  // instructions.
  $.root().contents().each((_i, node) => {
    if (node !== roots[0]) { $(node).remove(); removed += 1; }
  });

  $('*').each((_i, el) => {
    if (el.type !== 'tag') return;
    const tag = localName(el.name);
    if (SVG_REMOVE_ELEMENTS.has(tag)) { $(el).remove(); removed += 1; return; }
    if (SVG_ANIMATION_ELEMENTS.has(tag)) {
      const target = String(el.attribs?.attributeName || '').toLowerCase();
      if (/^(xlink:)?href$/.test(target) || target.startsWith('on')) { $(el).remove(); removed += 1; return; }
    }
    if (tag === 'style') {
      const css = $(el).text();
      const cleaned = stripExternalCss(css);
      if (cleaned !== css) { $(el).text(cleaned); removed += 1; }
    }
    for (const [attr, value] of Object.entries(el.attribs || {})) {
      const lower = attr.toLowerCase();
      const compact = String(value).replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
      const isHref = lower === 'href' || lower === 'xlink:href';
      if (lower.startsWith('on')
        || compact.includes('javascript:')
        || (isHref && !(String(value).trim().startsWith('#') || SAFE_DATA_IMAGE.test(String(value).trim())))) {
        $(el).removeAttr(attr);
        removed += 1;
      } else if (lower === 'style') {
        const cleaned = stripExternalCss(value);
        if (cleaned !== value) { $(el).attr(attr, cleaned); removed += 1; }
      }
    }
  });

  return { ok: true, text: $.xml(), removed };
}

// --- Writing -----------------------------------------------------------------------------
function readHead(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(SIGNATURE_BYTES);
    const n = fs.readSync(fd, buf, 0, SIGNATURE_BYTES, 0);
    return buf.subarray(0, n);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Which files of a presentation folder go into a .revel. Hidden (dot-prefixed) paths are local
// state and the builder's preview file is temporary, so neither is ever included.
// Returns { entries: [{ name, abs, buffer? }], omitted: [{ name, reason }], cleaned: [name] }.
// `entries[].buffer` is set for a sanitized SVG, whose content differs from the file on disk.
function planRevelContents(folderPath, { sanitize = true } = {}) {
  const root = path.resolve(folderPath);
  const entries = [];
  const omitted = [];
  const cleaned = [];

  const walk = (dir) => {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, dirent.name);
      const name = toPosix(path.relative(root, abs));
      if (hasHiddenSegment(name)) continue;
      if (dirent.isDirectory()) { walk(abs); continue; }
      if (!dirent.isFile()) continue;
      if (name === 'manifest.json' || path.posix.basename(name) === '__builder_temp.md') continue;

      const reason = prohibitionReason(name, readHead(abs));
      if (reason) { omitted.push({ name, reason }); continue; }

      if (finalExtension(name) === '.svg') {
        if (!sanitize) { entries.push({ name, abs }); continue; }
        const result = sanitizeSvg(fs.readFileSync(abs));
        if (!result.ok) { omitted.push({ name, reason: 'unsafe SVG' }); continue; }
        if (result.removed > 0) cleaned.push(name);
        entries.push({ name, abs, buffer: Buffer.from(result.text, 'utf8') });
        continue;
      }
      entries.push({ name, abs });
    }
  };
  walk(root);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, omitted, cleaned };
}

// Zip the planned entries plus manifest.json (already written to disk by the caller).
function writeRevelArchive(plan, manifestPath, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(manifestPath, { name: 'manifest.json' });
    for (const entry of plan.entries) {
      if (entry.buffer) archive.append(entry.buffer, { name: entry.name });
      else archive.file(entry.abs, { name: entry.name });
    }
    archive.finalize();
  });
}

// --- Reading -----------------------------------------------------------------------------
class SkipEntry extends Error {}

// Extract a .revel (or legacy .zip) into destPath, skipping everything section 3.1 prohibits,
// unsafe or hidden paths, and sanitizing SVG. Enforces size and entry limits.
// Returns { extracted, names: [extracted file names], skipped: [{ name, reason }], cleaned: [name] }.
async function extractRevelArchive(zipPath, destPath, { maxEntries = MAX_ENTRIES, maxTotalBytes = MAX_TOTAL_BYTES } = {}) {
  const dir = await unzipper.Open.file(zipPath);
  const files = dir.files || [];
  if (files.length > maxEntries) {
    throw new Error(`Archive has too many entries (${files.length}).`);
  }
  const declared = files.reduce((sum, f) => sum + (Number(f.uncompressedSize) || 0), 0);
  if (declared > maxTotalBytes) {
    throw new Error('Archive is too large when uncompressed.');
  }

  const root = path.resolve(destPath);
  fs.mkdirSync(root, { recursive: true });
  const skipped = [];
  const cleaned = [];
  const names = [];
  let extracted = 0;
  let totalBytes = 0;

  for (const entry of files) {
    const name = toPosix(entry.path);
    const isDirectory = entry.type === 'Directory' || name.endsWith('/');
    if (isUnsafeEntryName(name)) { skipped.push({ name, reason: 'unsafe path' }); continue; }
    if (hasHiddenSegment(name)) continue; // local state: ignored silently
    const dest = path.resolve(root, ...name.split('/').filter(Boolean));
    if (dest !== root && !dest.startsWith(root + path.sep)) { skipped.push({ name, reason: 'unsafe path' }); continue; }
    if (isDirectory) { fs.mkdirSync(dest, { recursive: true }); continue; }
    if (isProhibitedName(name)) { skipped.push({ name, reason: 'file type not allowed' }); continue; }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const isSvg = finalExtension(name) === '.svg';

    if (isSvg) {
      const chunks = [];
      let size = 0;
      let tooBig = false;
      await new Promise((resolve, reject) => {
        entry.stream().on('data', (chunk) => {
          size += chunk.length;
          totalBytes += chunk.length;
          if (size > MAX_SVG_BYTES) { tooBig = true; return; }
          if (totalBytes <= maxTotalBytes) chunks.push(chunk);
        }).on('end', resolve).on('error', reject);
      });
      if (totalBytes > maxTotalBytes) throw new Error('Archive is too large when uncompressed.');
      if (tooBig) { skipped.push({ name, reason: 'unsafe SVG' }); continue; }
      const result = sanitizeSvg(Buffer.concat(chunks));
      if (!result.ok) { skipped.push({ name, reason: 'unsafe SVG' }); continue; }
      if (result.removed > 0) cleaned.push(name);
      fs.writeFileSync(dest, result.text, 'utf8');
      extracted += 1;
      names.push(name);
      continue;
    }

    let first = true;
    let skipReason = '';
    const guard = new Transform({
      transform(chunk, _enc, cb) {
        if (first) {
          first = false;
          skipReason = prohibitionReason(name, chunk.subarray(0, SIGNATURE_BYTES));
          if (skipReason) return cb(new SkipEntry());
        }
        totalBytes += chunk.length;
        if (totalBytes > maxTotalBytes) return cb(new Error('Archive is too large when uncompressed.'));
        return cb(null, chunk);
      }
    });
    const outcome = await new Promise((resolve, reject) => {
      pipeline(entry.stream(), guard, fs.createWriteStream(dest), (err) => {
        if (err instanceof SkipEntry) resolve('skipped');
        else if (err) reject(err);
        else resolve('ok');
      });
    });
    if (outcome === 'skipped') {
      fs.rmSync(dest, { force: true });
      skipped.push({ name, reason: skipReason });
    } else {
      extracted += 1;
      names.push(name);
    }
  }
  return { extracted, names, skipped, cleaned };
}

// --- Versions ----------------------------------------------------------------------------
// Compare dotted numeric versions ("1.0.13"). >0 when a is newer than b. Unparseable parts count
// as 0, so a missing version is never newer than anything.
function compareVersions(a, b) {
  const parts = (v) => String(v || '').split(/[.\-+]/).slice(0, 3).map((p) => parseInt(p, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

module.exports = {
  PROHIBITED_EXTENSIONS,
  MAX_ENTRIES,
  MAX_TOTAL_BYTES,
  isProhibitedName,
  hasExecutableSignature,
  hasArchiveSignature,
  prohibitionReason,
  isUnsafeEntryName,
  hasHiddenSegment,
  needsOriginMark,
  sanitizeSvg,
  planRevelContents,
  writeRevelArchive,
  extractRevelArchive,
  compareVersions
};
