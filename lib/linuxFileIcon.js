// Linux file icon for .revel files.
//
// electron-builder cannot set a custom file icon on Linux: the shared-mime-info file it installs
// hard-codes the generic `x-office-document` icon, and desktop environments try that name first
// (checked with `gio info -a standard::icon`). The fix is a per-user override, installed by the app:
//
//   1. The REVELation icon, in several sizes, under the icon theme name for the MIME type.
//   2. A user-level MIME definition for the same type whose <icon> names that icon. The user's
//      database takes precedence over the system one the .deb/.rpm installed.
//
// This runs at startup rather than in the package so that it also works for AppImage builds and
// repairs itself if the files are removed. See doc/dev/REVEL_IMPLEMENTATION.md ("OS registration").
// Nothing here runs on Windows or macOS, or inside Flatpak or Snap sandboxes.
// Exports { ensureLinuxFileIcon, MIME_TYPE, ICON_NAME, ICON_SIZES, MIME_XML }. Called from main.js (5 s after
// startup, packaged builds only or REVELATION_FORCE_FILE_ICON=1); the stamp file lives in userData.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const MIME_TYPE = 'application/vnd.revelation.presentation+zip';
// shared-mime-info's default icon name for a type: the type with "/" replaced by "-".
const ICON_NAME = 'application-vnd.revelation.presentation+zip';
const MIME_FILE = 'revelation-snapshot-presenter-revel.xml';
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

// A .revel is a ZIP, so the type is declared a subclass of application/zip. That makes the archive
// manager available under "Open with", and is the fallback when no application is registered for
// the type itself (for example an AppImage). When the app is registered, the app is the default.
const MIME_XML = `<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="${MIME_TYPE}">
    <comment>REVELation Presentation</comment>
    <sub-class-of type="application/zip"/>
    <glob pattern="*.revel"/>
    <icon name="${ICON_NAME}"/>
    <generic-icon name="x-office-presentation"/>
  </mime-type>
</mime-info>
`;

function dataHome() {
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
}

function iconPathFor(home, size) {
  return path.join(home, 'icons', 'hicolor', `${size}x${size}`, 'mimetypes', `${ICON_NAME}.png`);
}

function isSandboxed() {
  return !!(process.env.FLATPAK_ID || process.env.SNAP);
}

// Resize with Electron's nativeImage. Injected in tests.
function renderPngWithElectron(sourcePath, size) {
  const { nativeImage } = require('electron');
  const image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error(`Could not read icon ${sourcePath}`);
  return image.resize({ width: size, height: size, quality: 'best' }).toPNG();
}

// Install (or refresh) the icon and MIME override. Returns { status, ... } and never throws for
// expected failures: a missing helper tool just leaves the generic icon in place.
async function ensureLinuxFileIcon({
  iconSource,
  appVersion = '',
  stampPath,
  log = () => {},
  platform = process.platform,
  renderPng = renderPngWithElectron,
  run = (cmd, args) => execFileAsync(cmd, args),
  force = false
} = {}) {
  if (platform !== 'linux') return { status: 'skipped', reason: 'not linux' };
  if (isSandboxed()) return { status: 'skipped', reason: 'sandboxed' };
  if (!iconSource || !fs.existsSync(iconSource)) return { status: 'skipped', reason: 'icon source missing' };

  const home = dataHome();
  const mimeDir = path.join(home, 'mime');
  const xmlPath = path.join(mimeDir, 'packages', MIME_FILE);
  const largest = iconPathFor(home, ICON_SIZES[ICON_SIZES.length - 1]);

  const sourceStat = fs.statSync(iconSource);
  // The MIME definition is part of the stamp, so a change to it replaces an older installed copy.
  const mimeHash = crypto.createHash('sha1').update(MIME_XML).digest('hex').slice(0, 8);
  const stamp = `${appVersion}|${sourceStat.size}|${Math.round(sourceStat.mtimeMs)}|${mimeHash}`;
  let current = '';
  try {
    current = stampPath ? JSON.parse(fs.readFileSync(stampPath, 'utf8')).stamp : '';
  } catch {
    current = '';
  }
  if (!force && current === stamp && fs.existsSync(xmlPath) && fs.existsSync(largest)) {
    return { status: 'current' };
  }

  for (const size of ICON_SIZES) {
    const target = iconPathFor(home, size);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, renderPng(iconSource, size));
  }

  fs.mkdirSync(path.dirname(xmlPath), { recursive: true });
  fs.writeFileSync(xmlPath, MIME_XML, 'utf8');

  const notes = [];
  try {
    await run('update-mime-database', [mimeDir]);
  } catch (err) {
    notes.push(`update-mime-database failed: ${err.message}`);
  }
  try {
    // -t: the per-user hicolor directory has no index.theme of its own.
    await run('gtk-update-icon-cache', ['-q', '-f', '-t', path.join(home, 'icons', 'hicolor')]);
  } catch {
    // Optional: GTK scans the directory anyway when no cache exists.
  }

  if (stampPath) {
    fs.mkdirSync(path.dirname(stampPath), { recursive: true });
    fs.writeFileSync(stampPath, JSON.stringify({ stamp, installedAt: new Date().toISOString() }), 'utf8');
  }
  for (const note of notes) log(`⚠️ ${note}`);
  return { status: 'installed', notes };
}

module.exports = { ensureLinuxFileIcon, MIME_TYPE, ICON_NAME, ICON_SIZES, MIME_XML };
