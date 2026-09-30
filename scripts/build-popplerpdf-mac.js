// Build the macOS Poppler payload for the popplerpdf plugin from conda-forge.
//
//   npm run build-popplerpdf-mac                 # architecture of this Mac
//   npm run build-popplerpdf-mac -- --arch=x64   # or arm64
//
// Must run on macOS (it needs otool, install_name_tool and codesign, and it
// runs the result as a test). Produces plugins/popplerpdf/poppler-<ver>-macos-<arch>/:
//
//   bin/       pdftoppm, pdfinfo, pdfimages: small wrappers that point fontconfig
//              at our fonts.conf, then exec the real tool
//   libexec/   the real conda-forge binaries (rpath @loader_path/../lib)
//   lib/       every dylib those binaries load, as plain files (no symlinks)
//   etc/fonts/ fonts.conf listing the macOS font folders
//   licenses/  license files of every conda package bundled, plus PACKAGES.txt
//
// Why the wrappers: conda-forge's fontconfig has its install prefix compiled in,
// so once moved it cannot find its config. FONTCONFIG_FILE overrides that.
// libpoppler's poppler-data path is compiled in the same way and has no
// override, so poppler-data is not bundled; it only matters for CJK PDFs that
// do not embed their fonts.
//
// Then run `npm run dist-popplerpdf-mac` (or the full dist-mac build) to zip it.
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execFileSync, spawnSync } = require('child_process');

const POPPLER_VERSION = process.env.POPPLER_VERSION || '26.09.0';
// Oldest macOS the packages may require. Electron's own minimum is macOS 12.
const MACOS_MIN_VERSION = process.env.POPPLER_MACOS_MIN || '12.0';
const TOOLS = ['pdftoppm', 'pdfinfo', 'pdfimages'];
// Loaded with dlopen by NSS, so they never show up in otool -L.
const DLOPEN_EXTRAS = ['libsoftokn3.dylib', 'libfreebl3.dylib', 'libnssckbi.dylib'];

const rootDir = path.resolve(__dirname, '..');
const pluginDir = path.join(rootDir, 'plugins', 'popplerpdf');

const CONDA_PLATFORM = { arm64: 'osx-arm64', x64: 'osx-64' };

function parseArch() {
  const arg = process.argv.find((a) => a.startsWith('--arch='));
  const arch = arg ? arg.slice('--arch='.length) : process.arch;
  if (!CONDA_PLATFORM[arch]) {
    throw new Error(`Unsupported architecture "${arch}". Use --arch=arm64 or --arch=x64.`);
  }
  return arch;
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

function downloadFile(url, destination, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    if (redirectDepth > 5) {
      reject(new Error('Too many redirects.'));
      return;
    }
    const req = https.get(url, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        downloadFile(next, destination, redirectDepth + 1).then(resolve).catch(reject);
        return;
      }
      if (code < 200 || code >= 300) {
        res.resume();
        reject(new Error(`Download of ${url} failed with HTTP ${code}`));
        return;
      }
      const out = fs.createWriteStream(destination);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('Download timed out.')));
  });
}

// Use MICROMAMBA_EXE or a micromamba on PATH; otherwise fetch the official
// static build for this Mac into the work folder.
async function resolveMicromamba(workDir) {
  if (process.env.MICROMAMBA_EXE) return process.env.MICROMAMBA_EXE;
  const onPath = spawnSync('/usr/bin/which', ['micromamba'], { encoding: 'utf8' });
  if (onPath.status === 0 && onPath.stdout.trim()) return onPath.stdout.trim();

  const hostPlatform = CONDA_PLATFORM[process.arch];
  const archive = path.join(workDir, 'micromamba.tar.bz2');
  const url = `https://micro.mamba.pm/api/micromamba/${hostPlatform}/latest`;
  console.log(`📥 Downloading micromamba from ${url}`);
  await downloadFile(url, archive);
  run('tar', ['-xjf', archive, '-C', workDir, 'bin/micromamba']);
  return path.join(workDir, 'bin', 'micromamba');
}

function createCondaEnv(micromamba, workDir, arch) {
  const envDir = path.join(workDir, 'env');
  const rootPrefix = path.join(workDir, 'root');
  console.log(`📦 Installing conda-forge poppler=${POPPLER_VERSION} for ${CONDA_PLATFORM[arch]} (macOS >= ${MACOS_MIN_VERSION})`);
  const result = spawnSync(micromamba, [
    'create', '-y',
    '-r', rootPrefix,
    '-p', envDir,
    '--platform', CONDA_PLATFORM[arch],
    '-c', 'conda-forge', '--override-channels',
    `poppler=${POPPLER_VERSION}`
  ], {
    stdio: 'inherit',
    env: { ...process.env, CONDA_OVERRIDE_OSX: MACOS_MIN_VERSION, MAMBA_ROOT_PREFIX: rootPrefix }
  });
  if (result.status !== 0) {
    throw new Error(`micromamba create failed (exit code ${result.status}).`);
  }
  return { envDir, pkgsDir: path.join(rootPrefix, 'pkgs') };
}

// Libraries a Mach-O file links against, from otool -L (first line is the file itself).
function linkedLibraries(file) {
  return run('otool', ['-L', file])
    .split('\n')
    .slice(1)
    .map((line) => line.trim().replace(/\s+\(compatibility.*$/, ''))
    .filter(Boolean)
    // A dylib lists its own install name first; skip it.
    .filter((name) => name !== `@rpath/${path.basename(file)}`);
}

function rpaths(file) {
  const lines = run('otool', ['-l', file]).split('\n');
  const result = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === 'cmd LC_RPATH') {
      const match = (lines[i + 2] || '').match(/path (.+) \(offset/);
      if (match) result.push(match[1]);
    }
  }
  return result;
}

function minOsVersion(file) {
  const match = run('otool', ['-l', file]).match(/minos (\d+(?:\.\d+)*)/);
  return match ? match[1] : null;
}

function isSystemLibrary(name) {
  return name.startsWith('/usr/lib/') || name.startsWith('/System/Library/');
}

function compareDotted(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Copy a file's real content (following symlinks) and make it writable so
// install_name_tool and codesign can modify it.
function copyReal(src, dest, mode) {
  fs.copyFileSync(fs.realpathSync(src), dest);
  fs.chmodSync(dest, mode);
}

function copyBinariesAndLibraries(envDir, payloadDir) {
  const libexecDir = path.join(payloadDir, 'libexec');
  const libDir = path.join(payloadDir, 'lib');
  fs.mkdirSync(libexecDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });

  const queue = [];
  for (const tool of TOOLS) {
    const src = path.join(envDir, 'bin', tool);
    if (!fs.existsSync(src)) throw new Error(`${tool} not found in the conda environment.`);
    const dest = path.join(libexecDir, tool);
    copyReal(src, dest, 0o755);
    queue.push(dest);
  }
  for (const name of DLOPEN_EXTRAS) {
    const src = path.join(envDir, 'lib', name);
    if (fs.existsSync(src)) {
      const dest = path.join(libDir, name);
      copyReal(src, dest, 0o644);
      queue.push(dest);
    }
  }

  const copied = new Set(fs.readdirSync(libDir));
  const machOFiles = [];
  while (queue.length) {
    const file = queue.shift();
    machOFiles.push(file);
    for (const lib of linkedLibraries(file)) {
      if (isSystemLibrary(lib)) continue;
      if (!lib.startsWith('@rpath/')) {
        throw new Error(`${path.basename(file)} links ${lib}, which is neither a system library nor @rpath-relative.`);
      }
      const name = lib.slice('@rpath/'.length);
      if (copied.has(name)) continue;
      const src = path.join(envDir, 'lib', name);
      if (!fs.existsSync(src)) {
        throw new Error(`${path.basename(file)} needs ${name}, which is missing from the conda environment.`);
      }
      copyReal(src, path.join(libDir, name), 0o644);
      copied.add(name);
      queue.push(path.join(libDir, name));
    }
  }
  return machOFiles;
}

// Absolute rpaths would point at the build machine's conda env; drop them so
// only @loader_path-relative lookups remain.
function stripAbsoluteRpaths(files) {
  for (const file of files) {
    for (const rp of rpaths(file)) {
      if (rp.startsWith('@')) continue;
      console.log(`✂️  Removing rpath ${rp} from ${path.basename(file)}`);
      run('install_name_tool', ['-delete_rpath', rp, file]);
    }
  }
}

function signAdHoc(files) {
  console.log(`🔏 Ad-hoc signing ${files.length} Mach-O files`);
  for (const file of files) {
    run('codesign', ['--force', '--sign', '-', file]);
  }
  for (const file of files) {
    run('codesign', ['--verify', '--strict', file]);
  }
}

function checkMinimumOs(files) {
  const tooNew = [];
  for (const file of files) {
    const minos = minOsVersion(file);
    if (minos && compareDotted(minos, MACOS_MIN_VERSION) > 0) {
      tooNew.push(`${path.basename(file)} (minos ${minos})`);
    }
  }
  if (tooNew.length) {
    throw new Error(`These files need a macOS newer than ${MACOS_MIN_VERSION}: ${tooNew.join(', ')}`);
  }
}

function writeFontsConf(payloadDir) {
  const fontsDir = path.join(payloadDir, 'etc', 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });
  fs.writeFileSync(path.join(fontsDir, 'fonts.conf'), `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<!-- Written by scripts/build-popplerpdf-mac.js. Used through FONTCONFIG_FILE,
     set by the wrappers in ../../bin, in place of the conda build's own
     config (whose path is compiled into libfontconfig). -->
<fontconfig>
  <dir>/System/Library/Fonts</dir>
  <dir>/Library/Fonts</dir>
  <dir>~/Library/Fonts</dir>
  <cachedir>~/Library/Caches/REVELation/fontconfig</cachedir>
  <!-- A family this Mac lacks (e.g. Calibri, not embedded) falls back to
       sans-serif rather than whatever font scores first. Must come before
       the aliases below; fontconfig applies rules in file order. -->
  <match target="pattern">
    <test qual="all" name="family" compare="not_eq"><string>sans-serif</string></test>
    <test qual="all" name="family" compare="not_eq"><string>serif</string></test>
    <test qual="all" name="family" compare="not_eq"><string>monospace</string></test>
    <edit name="family" mode="append_last"><string>sans-serif</string></edit>
  </match>
  <alias>
    <family>sans-serif</family>
    <prefer><family>Helvetica</family><family>Arial</family></prefer>
  </alias>
  <alias>
    <family>serif</family>
    <prefer><family>Times</family><family>Times New Roman</family></prefer>
  </alias>
  <alias>
    <family>monospace</family>
    <prefer><family>Menlo</family><family>Courier</family></prefer>
  </alias>
</fontconfig>
`);
}

function writeWrappers(payloadDir) {
  const binDir = path.join(payloadDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  for (const tool of TOOLS) {
    const wrapper = path.join(binDir, tool);
    fs.writeFileSync(wrapper, `#!/bin/sh
# Point fontconfig at the bundled config, then run the real ${tool}.
root="$(cd "$(dirname "$0")/.." && pwd)"
FONTCONFIG_FILE="$root/etc/fonts/fonts.conf"
export FONTCONFIG_FILE
exec "$root/libexec/${tool}" "$@"
`);
    fs.chmodSync(wrapper, 0o755);
  }
}

// Bundle each conda package's license files and a list of what is included.
function writeLicenses(envDir, pkgsDir, payloadDir) {
  const licensesDir = path.join(payloadDir, 'licenses');
  fs.mkdirSync(licensesDir, { recursive: true });
  const metaDir = path.join(envDir, 'conda-meta');
  const lines = [];
  let copiedCount = 0;
  for (const file of fs.readdirSync(metaDir).filter((f) => f.endsWith('.json')).sort()) {
    const meta = JSON.parse(fs.readFileSync(path.join(metaDir, file), 'utf8'));
    lines.push(`${meta.name} ${meta.version} ${meta.build} ${meta.license || ''}`.trim());
    // Newer micromamba keeps packages under pkgs/<channel URL>/...; the
    // conda-meta record says where. Fall back to the flat pkgs/<name> layout.
    const extractedDir = meta.extracted_package_dir || path.join(pkgsDir, path.basename(file, '.json'));
    const srcLicenses = path.join(extractedDir, 'info', 'licenses');
    if (fs.existsSync(srcLicenses)) {
      fs.cpSync(srcLicenses, path.join(licensesDir, meta.name), { recursive: true, dereference: true });
      copiedCount += 1;
    }
  }
  if (!copiedCount) {
    throw new Error('No package license files were found to bundle.');
  }
  fs.writeFileSync(path.join(payloadDir, 'PACKAGES.txt'),
    `conda-forge packages in this Poppler build (name version build license):\n\n${lines.join('\n')}\n`);
}

// A one-page PDF whose text uses a non-embedded font, so rendering it goes
// through fontconfig.
function writeTestPdf(file) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  const stream = 'BT /F1 24 Tf 36 60 Td (REVELation Poppler test) Tj ET';
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  fs.writeFileSync(file, body, 'latin1');
}

// Copy the payload somewhere else (with a space in the path, like
// "Application Support") and run it with a minimal environment, so anything
// still pointing at the build machine's conda env shows up here.
function testRelocated(payloadDir, workDir, arch) {
  const testRoot = path.join(workDir, 'relocation test');
  const relocated = path.join(testRoot, path.basename(payloadDir));
  fs.mkdirSync(testRoot, { recursive: true });
  fs.cpSync(payloadDir, relocated, { recursive: true });

  const pdf = path.join(testRoot, 'test.pdf');
  writeTestPdf(pdf);
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME || os.homedir() };
  const canRunHere = arch === process.arch || (arch === 'x64' && process.arch === 'arm64');
  if (!canRunHere) {
    console.warn(`⚠️  Cannot run ${arch} binaries on this ${process.arch} Mac; skipping the run test.`);
    return;
  }

  const info = spawnSync(path.join(relocated, 'bin', 'pdfinfo'), [pdf], { encoding: 'utf8', env });
  if (info.status !== 0 || !/Pages:\s+1/.test(info.stdout)) {
    throw new Error(`pdfinfo test failed:\n${info.stdout}\n${info.stderr}`);
  }

  const outPrefix = path.join(testRoot, 'page');
  const render = spawnSync(path.join(relocated, 'bin', 'pdftoppm'), ['-png', '-r', '72', pdf, outPrefix], { encoding: 'utf8', env });
  const rendered = fs.readdirSync(testRoot).filter((f) => f.startsWith('page') && f.endsWith('.png'));
  if (render.status !== 0 || rendered.length !== 1 || fs.statSync(path.join(testRoot, rendered[0])).size === 0) {
    throw new Error(`pdftoppm test failed:\n${render.stdout}\n${render.stderr}`);
  }
  if (/fontconfig/i.test(render.stderr)) {
    throw new Error(`pdftoppm reported a fontconfig problem:\n${render.stderr}`);
  }
  console.log(`✅ Relocated test passed: pdfinfo and pdftoppm ran from "${testRoot}"`);
}

function removeExistingPopplerPayloads() {
  if (!fs.existsSync(pluginDir)) return;
  for (const entry of fs.readdirSync(pluginDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('poppler-')) {
      fs.rmSync(path.join(pluginDir, entry.name), { recursive: true, force: true });
    }
  }
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('build-popplerpdf-mac must run on macOS.');
  }
  const arch = parseArch();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revelation-poppler-mac-'));
  try {
    const micromamba = await resolveMicromamba(workDir);
    const { envDir, pkgsDir } = createCondaEnv(micromamba, workDir, arch);

    removeExistingPopplerPayloads();
    const payloadDir = path.join(pluginDir, `poppler-${POPPLER_VERSION}-macos-${arch}`);
    fs.mkdirSync(payloadDir, { recursive: true });

    const machOFiles = copyBinariesAndLibraries(envDir, payloadDir);
    stripAbsoluteRpaths(machOFiles);
    signAdHoc(machOFiles);
    checkMinimumOs(machOFiles);
    writeFontsConf(payloadDir);
    writeWrappers(payloadDir);
    writeLicenses(envDir, pkgsDir, payloadDir);
    testRelocated(payloadDir, workDir, arch);

    console.log(`✅ Poppler ${POPPLER_VERSION} payload for macOS ${arch} is in ${payloadDir} (${machOFiles.length} Mach-O files)`);
  } finally {
    if (!process.env.KEEP_POPPLER_WORKDIR) {
      fs.rmSync(workDir, { recursive: true, force: true });
    } else {
      console.log(`ℹ️  Work folder kept at ${workDir}`);
    }
  }
}

main().catch((err) => {
  console.error(`❌ build-popplerpdf-mac failed: ${err.message}`);
  process.exit(1);
});
