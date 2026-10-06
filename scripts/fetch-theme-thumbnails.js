// scripts/fetch-theme-thumbnails.js
// Downloads theme thumbnail images into revelation/css/theme-thumbnails/ (source, not dist)
// Build process copies them from source to dist.
const fs = require('fs');
const path = require('path');
const { downloadFile } = require('./lib/download');

const BASE = 'https://www.pastordaniel.net/bigmedia/revelation/theme-thumbnails';
const OUTDIR = path.join(__dirname, '..', 'revelation', 'css', 'theme-thumbnails');
const SCSS_DIR = path.join(__dirname, '..', 'revelation', 'css', 'source');
const EXCLUDE = new Set(['handout.scss', 'presentations.scss', 'medialibrary.scss', 'lowerthirds.scss', 'confidencemonitor.scss', 'notes-teleprompter.scss']);

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

  const scssFiles = fs.readdirSync(SCSS_DIR)
    .filter(name => name.endsWith('.scss'))
    .filter(name => !EXCLUDE.has(name));

  if (scssFiles.length === 0) {
    console.warn('⚠️ No SCSS files found to match thumbnails.');
    return;
  }

  for (const scssFile of scssFiles) {
    const jpgName = scssFile.replace(/\.scss$/i, '.jpg');
    const url = `${BASE}/${jpgName}`;
    const dest = path.join(OUTDIR, jpgName);

    console.log(`📥 ${jpgName}`);
    try {
      await downloadFile(url, dest);
      console.log(`✓ Saved ${dest}`);
    } catch (e) {
      if (e && /HTTP 404/.test(e.message)) {
        console.log(`ℹ️ ${jpgName} not found on CDN, skipping`);
      } else {
        console.warn(`⚠️ Failed ${jpgName}: ${e.message}`);
      }
    }
  }
}

main();
