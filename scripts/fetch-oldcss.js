// scripts/fetch-oldcss.js
// Downloads oldcss/1.0.6 assets from the remote CDN using a manifest.
// Files already present on disk are skipped.
const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = 'https://www.pastordaniel.net/bigmedia/revelation/oldcss';
const MANIFEST_URL = `${BASE}/manifest.json`;
const OUTDIR = path.join(__dirname, '..', 'revelation', 'assets', 'oldcss');

async function main() {
  // If the directory exists and has files, assume they're already downloaded
  if (fs.existsSync(OUTDIR) && fs.readdirSync(OUTDIR).length > 0) {
    console.log('✓ oldcss already present, skipping fetch.');
    return;
  }

  console.log('📋 Fetching oldcss manifest…');
  let manifest;
  try {
    manifest = JSON.parse(await fetchText(MANIFEST_URL));
  } catch (e) {
    console.error(`✗ Could not fetch manifest: ${e.message}`);
    process.exit(1);
  }

  if (!Array.isArray(manifest) || manifest.length === 0) {
    console.warn('⚠️ Manifest is empty or invalid, skipping.');
    return;
  }

  fs.mkdirSync(OUTDIR, { recursive: true });

  let fetched = 0;
  let skipped = 0;

  for (const relPath of manifest) {
    const dest = path.join(OUTDIR, relPath);
    if (fs.existsSync(dest)) {
      skipped++;
      continue;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const url = `${BASE}/${relPath}`;
    console.log(`📥 ${relPath}`);
    try {
      await downloadFile(url, dest);
      fetched++;
    } catch (e) {
      console.warn(`⚠️ Failed ${relPath}: ${e.message}`);
    }
  }

  console.log(`✓ oldcss: ${fetched} downloaded, ${skipped} already present.`);
}

function fetchText(url, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectDepth < 3) {
        fetchText(res.headers.location, redirectDepth + 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
  });
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
