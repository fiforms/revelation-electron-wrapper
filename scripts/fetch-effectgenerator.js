// scripts/fetch-effectgenerator.js: downloads the platform-specific effectgenerator binary into bin/
const fs = require('fs');
const path = require('path');
const https = require('https');

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

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode !== 200) {
        file.close(() => fs.unlink(dest, () => reject(new Error('HTTP ' + res.statusCode))));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => {
      file.close(() => fs.unlink(dest, () => reject(err)));
    });
  });
}

main();
