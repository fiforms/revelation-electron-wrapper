#!/usr/bin/env node

// Fetch all remote assets: Bibles, ffmpeg (macOS/Windows), effectgenerator, theme thumbnails, oldcss, mediafx gallery
// previews and the WordPress plugin PHP libraries. The single list of what to download: scripts/postinstall.js runs
// this file, so add new fetch steps here only. Run manually (npm run fetch-blobs) if SKIP_BLOBS was used during npm install.

const { execSync } = require('child_process');
const path = require('path');

function run(command, options = {}) {
  execSync(command, { stdio: 'inherit', ...options });
}

const rootDir = path.resolve(__dirname, '..');

console.log('📦 Fetching all remote blobs...\n');

console.log('📥 Fetching Bibles...');
require('../plugins/bibletext/fetch-bibles');

console.log('\n📥 Fetching ffmpeg (macOS/Windows only)...');
require('./fetch-ffmpeg');

console.log('\n📥 Fetching effectgenerator...');
require('./fetch-effectgenerator');

console.log('\n📥 Fetching theme thumbnails...');
require('./fetch-theme-thumbnails');

console.log('\n📥 Fetching oldcss...');
require('../revelation/scripts/fetch-oldcss').main().catch(err => console.warn('Warning: oldcss fetch failed:', err.message));

console.log('\n📥 Fetching mediafx gallery...');
require('./fetch-mediafx-gallery');

console.log('\n📥 Fetching WordPress plugin libraries...');
try {
  run(`node scripts/download-libs.js`, { cwd: rootDir });
} catch (error) {
  console.warn('⚠️  Warning: Failed to download WordPress plugin libraries:', error.message);
}

console.log('\n✅ Blob download complete!');
