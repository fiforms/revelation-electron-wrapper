#!/usr/bin/env node

// Fetch all remote assets: www.pastordaniel.net blobs and GitHub-hosted WordPress libraries
// Can be called manually if SKIP_BLOBS was used during npm install

const { execSync } = require('child_process');
const path = require('path');

function run(command, options = {}) {
  execSync(command, { stdio: 'inherit', ...options });
}

const rootDir = path.resolve(__dirname, '..');

console.log('📦 Fetching all remote blobs...\n');

console.log('📥 Fetching Bibles...');
require('../plugins/bibletext/fetch-bibles');

console.log('\n📥 Fetching effectgenerator...');
require('./fetch-effectgenerator');

console.log('\n📥 Fetching theme thumbnails...');
require('./fetch-theme-thumbnails');

console.log('\n📥 Fetching oldcss...');
require('./fetch-oldcss');

console.log('\n📥 Fetching mediafx gallery...');
require('./fetch-mediafx-gallery');

console.log('\n📥 Fetching WordPress plugin libraries...');
try {
  run(`node scripts/download-libs.js`, { cwd: rootDir });
} catch (error) {
  console.warn('⚠️  Warning: Failed to download WordPress plugin libraries:', error.message);
}

console.log('\n✅ Blob download complete!');
