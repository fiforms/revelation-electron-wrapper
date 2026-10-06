// scripts/fetch-effectgenerator.js: downloads the platform-specific effectgenerator binary into bin/
const fs = require('fs');
const path = require('path');
const { downloadFile } = require('./lib/download');

const BASE = 'https://www.pastordaniel.net/bigmedia/effectgenerator';
const OUTDIR = path.join(__dirname, '..', 'bin');

async function main() {
  const platform = process.platform;
  const arch = process.arch;
  const exeName = platform === 'win32' ? 'effectgenerator.exe' : 'effectgenerator';
  const url = `${BASE}/${platform}/${arch}/${exeName}`;
  const dest = path.join(OUTDIR, exeName);

  try {
    fs.mkdirSync(OUTDIR, { recursive: true });
  } catch {}

  console.log(`📥 Downloading effectgenerator for ${platform}/${arch}…`);
  try {
    await downloadFile(url, dest);
    if (platform !== 'win32') {
      fs.chmodSync(dest, 0o755);
    }
    console.log(`✓ Saved ${dest}`);
  } catch (e) {
    console.warn(`⚠️ Failed to download effectgenerator: ${e.message}`);
  }
}

main();
