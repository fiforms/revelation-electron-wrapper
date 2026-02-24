// make-manifest.js
//
// Scans the current directory for Bible source files (*.xml or *.xml.gz),
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
  const sourceFiles = fs.readdirSync(DIR)
    .filter((f) => {
      const lower = f.toLowerCase();
      return lower.endsWith('.xml') || lower.endsWith('.xml.gz');
    });

  if (sourceFiles.length === 0) {
    console.warn("⚠️ No Bible source files found (.xml or .xml.gz).");
    process.exit(0);
  }

  // If both foo.xml and foo.xml.gz exist, prefer foo.xml.gz for download size.
  const byBaseName = new Map();
  for (const name of sourceFiles) {
    const base = name.replace(/\.xml(?:\.gz)?$/i, '');
    const existing = byBaseName.get(base);
    if (!existing) {
      byBaseName.set(base, name);
      continue;
    }
    const existingIsGz = existing.toLowerCase().endsWith('.xml.gz');
    const candidateIsGz = name.toLowerCase().endsWith('.xml.gz');
    if (!existingIsGz && candidateIsGz) {
      byBaseName.set(base, name);
    }
  }

  const files = Array.from(byBaseName.values()).sort((a, b) => a.localeCompare(b));

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
