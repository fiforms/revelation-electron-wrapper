#!/usr/bin/env node

// Copy theme thumbnails from revelation/css/theme-thumbnails (source) to revelation/dist/css/theme-thumbnails (dist)
// Called during build to include cached thumbnails in the distribution

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'revelation', 'css', 'theme-thumbnails');
const DIST_DIR = path.join(__dirname, '..', 'revelation', 'dist', 'css', 'theme-thumbnails');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.log(`ℹ️ Source theme-thumbnails not found: ${src}`);
    return;
  }

  try {
    fs.mkdirSync(dest, { recursive: true });
  } catch {}

  const files = fs.readdirSync(src);
  if (files.length === 0) {
    console.log(`ℹ️ No theme thumbnails to copy.`);
    return;
  }

  for (const file of files) {
    const srcFile = path.join(src, file);
    const destFile = path.join(dest, file);
    fs.copyFileSync(srcFile, destFile);
  }

  console.log(`✓ Copied ${files.length} theme thumbnails to dist.`);
}

copyDir(SRC_DIR, DIST_DIR);
