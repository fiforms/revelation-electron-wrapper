const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const { app } = require('electron');
const which = require('which');

// PowerPoint-style formats LibreOffice can turn into PDF for the PDF import path.
const POWERPOINT_EXTENSIONS = ['pptx', 'ppt', 'ppsx', 'pps', 'odp'];
const CONVERT_TIMEOUT_MS = 5 * 60 * 1000;

function isPowerPointFile(filePath) {
  const ext = path.extname(String(filePath || '')).slice(1).toLowerCase();
  return POWERPOINT_EXTENSIONS.includes(ext);
}

// LibreOffice falls back to importing unreadable files as plain text and "succeeds",
// so check the container signature first: OOXML/ODF are ZIPs, legacy .ppt/.pps are OLE2.
function looksLikePresentation(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const expected = ['ppt', 'pps'].includes(ext)
    ? Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    : Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const header = Buffer.alloc(expected.length);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, header, 0, expected.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  return header.equals(expected);
}

function candidatePaths() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const roots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
      'C:\\Program Files',
      'C:\\Program Files (x86)'
    ].filter(Boolean);
    return roots.map((root) => path.join(root, 'LibreOffice', 'program', 'soffice.exe'));
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      path.join(home, 'Applications', 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')
    ];
  }
  const optInstalls = (() => {
    try {
      return fs.readdirSync('/opt')
        .filter((name) => /^libreoffice/i.test(name))
        .sort()
        .reverse()
        .map((name) => path.join('/opt', name, 'program', 'soffice'));
    } catch {
      return [];
    }
  })();
  return [
    '/usr/bin/soffice',
    '/usr/bin/libreoffice',
    '/usr/lib/libreoffice/program/soffice',
    '/usr/lib64/libreoffice/program/soffice',
    '/usr/local/bin/soffice',
    '/usr/local/bin/libreoffice',
    ...optInstalls,
    '/snap/bin/libreoffice',
    '/var/lib/flatpak/exports/bin/org.libreoffice.LibreOffice',
    path.join(home, '.local', 'share', 'flatpak', 'exports', 'bin', 'org.libreoffice.LibreOffice')
  ];
}

/**
 * Resolves the LibreOffice (soffice) binary with a fallback chain:
 * 1. User-configured path (AppContext.config.libreofficePath)
 * 2. Common install locations for the current platform
 * 3. System PATH (soffice, then libreoffice)
 * Returns null when LibreOffice cannot be found.
 */
async function resolveLibreOfficeBinary(AppContext) {
  const configured = String(AppContext?.config?.libreofficePath || '').trim();
  if (configured && fs.existsSync(configured)) {
    return configured;
  }

  for (const candidate of candidatePaths()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const names = process.platform === 'win32' ? ['soffice.exe'] : ['soffice', 'libreoffice'];
  for (const name of names) {
    try {
      return await which(name);
    } catch {
      // try next
    }
  }
  return null;
}

// Runs one headless conversion of sourcePath into outDir; returns the output file path.
// Uses a private LibreOffice profile so conversion works even while the user
// has LibreOffice open, and keeps all paths under userData so sandboxed
// installs (Flatpak/Snap, which get a private /tmp) can still read and write them.
async function runConversion(AppContext, soffice, sourcePath, format, outDir) {
  const profileDir = path.join(app.getPath('userData'), 'libreoffice-profile');
  const args = [
    '--headless',
    '--norestore',
    '--nologo',
    '--nodefault',
    '--nolockcheck',
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    '--convert-to', format,
    '--outdir', outDir,
    sourcePath
  ];

  AppContext?.log?.(`[libreoffice] Converting ${path.basename(sourcePath)} to ${format} with ${soffice}`);
  await new Promise((resolve, reject) => {
    execFile(soffice, args, { windowsHide: true, timeout: CONVERT_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) {
        const message = err.killed
          ? 'LibreOffice timed out while converting the presentation.'
          : (stderr || err.message || 'LibreOffice conversion failed.').trim();
        const wrapped = new Error(message);
        wrapped.code = err.code;
        return reject(wrapped);
      }
      resolve(stdout);
    });
  });

  const outName = fs.readdirSync(outDir).find((name) => name.toLowerCase().endsWith(`.${format}`));
  if (!outName) {
    throw new Error(`LibreOffice finished but produced no ${format.toUpperCase()}. The file may be damaged or password-protected.`);
  }
  return path.join(outDir, outName);
}

async function prepareConversion(AppContext, sourcePath) {
  const soffice = await resolveLibreOfficeBinary(AppContext);
  if (!soffice) {
    const err = new Error('LibreOffice was not found. Install it, or set its path in Settings → Folders & Paths.');
    err.missingLibreOffice = true;
    throw err;
  }
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`File not found: ${sourcePath}`);
  }
  if (!looksLikePresentation(sourcePath)) {
    throw new Error(`${path.basename(sourcePath)} is not a valid PowerPoint file (it may be damaged or renamed).`);
  }
  return soffice;
}

/**
 * Converts a PowerPoint-style file to PDF with headless LibreOffice.
 * The caller owns the returned workDir and must remove it when done.
 */
async function convertToPdf(AppContext, sourcePath) {
  const soffice = await prepareConversion(AppContext, sourcePath);
  const workDir = path.join(app.getPath('userData'), 'pdf-conversions', crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(workDir, { recursive: true });
  try {
    const pdfPath = await runConversion(AppContext, soffice, sourcePath, 'pdf', workDir);
    return { pdfPath, workDir, soffice };
  } catch (err) {
    fs.rmSync(workDir, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Converts a presentation (e.g. .odp, .ppt) to .pptx so its speaker notes can be
 * read with the PPTX notes parser. Writes into a subfolder of the caller's workDir.
 */
async function convertToPptx(AppContext, sourcePath, workDir) {
  const soffice = await prepareConversion(AppContext, sourcePath);
  const outDir = path.join(workDir, 'pptx');
  fs.mkdirSync(outDir, { recursive: true });
  return runConversion(AppContext, soffice, sourcePath, 'pptx', outDir);
}

module.exports = {
  POWERPOINT_EXTENSIONS,
  isPowerPointFile,
  resolveLibreOfficeBinary,
  convertToPdf,
  convertToPptx
};
