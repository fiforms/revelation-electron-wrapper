// Download-origin marks: Mark-of-the-Web (Windows) and the quarantine attribute (macOS).
//
// Browsers and mail clients put these on files they download. The operating system uses them to
// apply Protected View, macro blocking and Gatekeeper to those files. Archive tools copy the mark
// from the archive onto every file they extract; Node's extraction does not, so without this a
// .docx taken out of a downloaded .revel would look like a trusted local file.
//
// Only files REVELation does not consume itself are marked (see needsOriginMark): documents,
// PDFs and other project files that the user may later open in another program. Marking is best
// effort and never fails an import. Linux has no equivalent mark.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { needsOriginMark } = require('./revelFormat');

const execFileAsync = promisify(execFile);
const WINDOWS_STREAM = ':Zone.Identifier';
const MAC_ATTRIBUTE = 'com.apple.quarantine';
const XATTR = '/usr/bin/xattr';
const XATTR_BATCH = 50;

function defaultDeps() {
  return {
    platform: process.platform,
    readFile: (file) => fs.promises.readFile(file),
    writeFile: (file, data) => fs.promises.writeFile(file, data),
    run: (cmd, args) => execFileAsync(cmd, args)
  };
}

// The mark on a file the user got from elsewhere, or null if it has none (it was not downloaded)
// or this platform has no such mark.
async function readOriginMark(sourceFile, deps = defaultDeps()) {
  try {
    if (deps.platform === 'win32') {
      const data = await deps.readFile(sourceFile + WINDOWS_STREAM);
      return data && data.length ? { platform: 'win32', data } : null;
    }
    if (deps.platform === 'darwin') {
      const { stdout } = await deps.run(XATTR, ['-p', MAC_ATTRIBUTE, sourceFile]);
      const value = String(stdout || '').trim();
      return value ? { platform: 'darwin', value } : null;
    }
  } catch {
    // No stream or attribute: the file was not downloaded, or the file system has no support.
  }
  return null;
}

// The mark for a file this app downloaded itself (URL import).
function downloadMark(sourceUrl, deps = defaultDeps()) {
  if (deps.platform === 'win32') {
    const host = String(sourceUrl || '').replace(/[\r\n]/g, '');
    const lines = ['[ZoneTransfer]', 'ZoneId=3'];
    if (host) lines.push(`HostUrl=${host}`);
    return { platform: 'win32', data: Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8') };
  }
  if (deps.platform === 'darwin') {
    // flags;hex timestamp;agent name;event UUID (left empty)
    const stamp = Math.floor(Date.now() / 1000).toString(16);
    return { platform: 'darwin', value: `0081;${stamp};REVELation;` };
  }
  return null;
}

// Apply a mark to files under root. Returns how many were marked.
async function applyOriginMark(mark, root, names, deps = defaultDeps()) {
  if (!mark || !names.length) return 0;
  const targets = names.map((name) => path.join(root, ...name.split('/')));
  let marked = 0;

  if (mark.platform === 'win32' && deps.platform === 'win32') {
    for (const target of targets) {
      try {
        await deps.writeFile(target + WINDOWS_STREAM, mark.data);
        marked += 1;
      } catch {
        // File system without alternate data streams (FAT, exFAT, some network shares).
      }
    }
  } else if (mark.platform === 'darwin' && deps.platform === 'darwin') {
    for (let i = 0; i < targets.length; i += XATTR_BATCH) {
      const chunk = targets.slice(i, i + XATTR_BATCH);
      try {
        await deps.run(XATTR, ['-w', MAC_ATTRIBUTE, mark.value, ...chunk]);
        marked += chunk.length;
      } catch {
        // Attribute could not be set; leave the files unmarked.
      }
    }
  }
  return marked;
}

// Copy the mark of an archive onto the files extracted from it.
async function propagateOriginMark(sourceFile, root, extractedNames, deps = defaultDeps()) {
  const names = extractedNames.filter(needsOriginMark);
  if (!names.length) return 0;
  const mark = await readOriginMark(sourceFile, deps);
  return applyOriginMark(mark, root, names, deps);
}

// Mark files this app downloaded from a URL.
async function markDownloaded(root, names, sourceUrl, deps = defaultDeps()) {
  const filtered = names.filter(needsOriginMark);
  if (!filtered.length) return 0;
  return applyOriginMark(downloadMark(sourceUrl, deps), root, filtered, deps);
}

module.exports = {
  readOriginMark,
  downloadMark,
  applyOriginMark,
  propagateOriginMark,
  markDownloaded
};
