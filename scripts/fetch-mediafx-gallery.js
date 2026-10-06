// scripts/fetch-mediafx-gallery.js
const fs = require('fs');
const path = require('path');
const { downloadFile } = require('./lib/download');

const BASE = 'https://www.pastordaniel.net/bigmedia/mediafx/gallery';
const GALLERY_DIR = path.join(__dirname, '..', 'plugins', 'mediafx', 'gallery');
const MEDIA_EXTENSIONS = ['jpg', 'mp4'];

async function main() {
  if (!fs.existsSync(GALLERY_DIR)) {
    console.warn(`⚠️ Gallery directory missing: ${GALLERY_DIR}`);
    return;
  }

  const entries = fs.readdirSync(GALLERY_DIR, { withFileTypes: true });
  const baseNames = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map(entry => path.basename(entry.name, '.json'))
    .sort((a, b) => a.localeCompare(b));

  if (baseNames.length === 0) {
    console.log('ℹ️ No mediafx gallery presets found.');
    return;
  }

  for (const baseName of baseNames) {
    for (const ext of MEDIA_EXTENSIONS) {
      const fileName = `${baseName}.${ext}`;
      const dest = path.join(GALLERY_DIR, fileName);

      if (fs.existsSync(dest)) {
        console.log(`✓ ${fileName} already present`);
        continue;
      }

      const url = `${BASE}/${fileName}`;
      console.log(`📥 ${fileName}`);
      try {
        await downloadFile(url, dest);
        console.log(`✓ Saved ${dest}`);
      } catch (err) {
        if (err && /HTTP 404/.test(err.message)) {
          console.log(`ℹ️ ${fileName} not found on CDN, skipping`);
        } else {
          console.warn(`⚠️ Failed ${fileName}: ${err.message}`);
        }
      }
    }
  }
}

main();
