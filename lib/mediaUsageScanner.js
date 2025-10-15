// lib/mediaUsageScanner.js
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

async function scanAllPresentations(presentationsDir) {
  const used = new Set();

  if (!fs.existsSync(presentationsDir)) {
    console.warn(`scanAllPresentations: missing dir ${presentationsDir}`);
    return used;
  }

  // Find all subfolders that contain .md files
  const folders = fs.readdirSync(presentationsDir)
    .map(f => path.join(presentationsDir, f))
    .filter(f => fs.statSync(f).isDirectory());

  for (const folder of folders) {
    const mdFiles = fs.readdirSync(folder).filter(f => f.endsWith('.md'));
    for (const md of mdFiles) {
      const fullPath = path.join(folder, md);
      try {
        const text = fs.readFileSync(fullPath, 'utf-8');
        extractUsedMedia(text, used);
      } catch (err) {
        console.warn(`⚠️ Failed reading ${fullPath}: ${err.message}`);
      }
    }
  }

  return used;
}

function extractUsedMedia(text, usedSet) {
  // --- Extract YAML Front Matter ---
  const fmMatch = text.match(/^---\s*([\s\S]*?)---\s*/);
  if (fmMatch) {
    try {
      const metadata = yaml.load(fmMatch[1]) || {};
      if (metadata.media && typeof metadata.media === 'object') {
        for (const entry of Object.values(metadata.media)) {
          if (entry.filename) usedSet.add(path.basename(entry.filename));
        }
      }
    } catch (err) {
      console.warn('⚠️ YAML parse error:', err.message);
    }
  }

  // --- Extract Markdown Body ---
  const body = fmMatch ? text.slice(fmMatch[0].length) : text;

  // match ![](...filename...)
  const imageMatches = [...body.matchAll(/!\[[^\]]*?\]\(([^)]+)\)/g)];
  for (const m of imageMatches) {
    const src = m[1];
    const fname = path.basename(src.split('?')[0]);
    if (fname.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|mov|mkv)$/i)) {
      usedSet.add(fname);
    }
  }

  // match media:alias references
  const mediaRefs = [...body.matchAll(/media:([a-zA-Z0-9_-]+)/g)];
  for (const ref of mediaRefs) {
    usedSet.add(`alias:${ref[1]}`);
  }

  // match Reveal.js-style background-video or background-image
  const bgRefs = [...body.matchAll(/data-background-(?:video|image)="([^"]+)"/g)];
  for (const b of bgRefs) {
    usedSet.add(path.basename(b[1]));
  }
}

module.exports = { scanAllPresentations };
