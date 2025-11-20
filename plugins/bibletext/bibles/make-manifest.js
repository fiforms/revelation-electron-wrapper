// make-manifest.js
//
// Scans the current directory for *.xml.gz files,
// computes sha256 hashes, and writes manifest.json.
//
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const DIR = process.cwd();
const OUTFILE = path.join(DIR, 'manifest.json');

console.log("📘 Building manifest from:", DIR);

function sha256(filepath) {
  const buf = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function buildManifest() {
  const files = fs.readdirSync(DIR)
    .filter(f => f.toLowerCase().endsWith('.xml.gz'));

  if (files.length === 0) {
    console.warn("⚠️ No .xml.gz files found.");
    process.exit(0);
  }

  const manifest = {
    generated: new Date().toISOString(),
    files: files.map(name => {
      const full = path.join(DIR, name);
      return {
        name,
        sha256: sha256(full)
      };
    })
  };

  fs.writeFileSync(OUTFILE, JSON.stringify(manifest, null, 2));
  console.log(`✅ Wrote ${OUTFILE} (${manifest.files.length} entries)`);
}

buildManifest();
