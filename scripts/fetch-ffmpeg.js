// scripts/fetch-ffmpeg.js
const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = 'https://www.pastordaniel.net/bigmedia/ffmpeg';
const OUTDIR = path.join(__dirname, '..', 'bin', 'ffmpeg');

async function main() {
  const platform = process.platform;
  const arch = process.arch;

  const supported = (platform === 'darwin' || platform === 'win32');
  if (!supported) {
    console.log(`ℹ️  No bundled ffmpeg for ${platform}/${arch} — will use system ffmpeg.`);
    return;
  }

  const isWin = platform === 'win32';
  const files = isWin
    ? ['ffmpeg.exe', 'versions.txt']
    : ['ffmpeg', 'versions.txt'];

  try {
    fs.mkdirSync(OUTDIR, { recursive: true });
  } catch {}

  console.log(`📥 Downloading ffmpeg binaries for ${platform}/${arch}…`);

  for (const filename of files) {
    const url = `${BASE}/${platform}/${arch}/${filename}`;
    const dest = path.join(OUTDIR, filename);
    try {
      await downloadFile(url, dest);
      if (!isWin && filename !== 'versions.txt') {
        fs.chmodSync(dest, 0o755);
      }
      console.log(`✓ Saved ${dest}`);
    } catch (e) {
      console.warn(`⚠️  Failed to download ${filename}: ${e.message}`);
    }
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(() => fs.unlink(dest, () => {}));
        return downloadFile(res.headers.location, dest).then(resolve, reject);
      }
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
