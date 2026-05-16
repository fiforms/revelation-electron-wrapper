// scripts/fetch-theme-thumbnails.js
// Downloads theme thumbnail images into revelation/css/theme-thumbnails/ (source, not dist)
// Build process copies them from source to dist.
const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = 'https://www.pastordaniel.net/bigmedia/revelation/theme-thumbnails';
const OUTDIR = path.join(__dirname, '..', 'revelation', 'css', 'theme-thumbnails');
const CSS_DIR = path.join(__dirname, '..', 'revelation', 'css');
const EXCLUDE = new Set(['handout.css', 'presentations.css', 'medialibrary.css', 'lowerthirds.css', 'confidencemonitor.css', 'notes-teleprompter.css']);

async function main() {
  try {
    fs.mkdirSync(OUTDIR, { recursive: true });
  } catch {}

  // If thumbnail directory already has files, skip fetching
  const existingThumbnails = fs.readdirSync(OUTDIR).length;
  if (existingThumbnails > 0) {
    console.log(`✓ Theme thumbnails already present (${existingThumbnails} files), skipping fetch.`);
    return;
  }

  const cssFiles = fs.readdirSync(CSS_DIR)
    .filter(name => name.endsWith('.css'))
    .filter(name => !EXCLUDE.has(name));

  if (cssFiles.length === 0) {
    console.warn('⚠️ No CSS files found to match thumbnails.');
    return;
  }

  for (const cssFile of cssFiles) {
    const jpgName = cssFile.replace(/\.css$/i, '.jpg');
    const url = `${BASE}/${jpgName}`;
    const dest = path.join(OUTDIR, jpgName);

    console.log(`📥 ${jpgName}`);
    try {
      await downloadFile(url, dest);
      console.log(`✓ Saved ${dest}`);
    } catch (e) {
      console.warn(`⚠️ Failed ${jpgName}: ${e.message}`);
    }
  }
}

function downloadFile(url, dest, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectDepth < 3) {
        file.close(() => fs.unlink(dest, () => {
          downloadFile(res.headers.location, dest, redirectDepth + 1).then(resolve).catch(reject);
        }));
        return;
      }
      if (res.statusCode !== 200) {
        file.close(() => fs.unlink(dest, () => reject(new Error('HTTP ' + res.statusCode))));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('error', err => {
      file.close(() => fs.unlink(dest, () => reject(err)));
    });
  });
}

main();
