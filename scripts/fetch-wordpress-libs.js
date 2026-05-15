#!/usr/bin/env node

// Download WordPress plugin PHP dependencies from GitHub
// Can be called independently if only WordPress libraries are needed

const { execSync } = require('child_process');
const path = require('path');

function run(command, options = {}) {
  execSync(command, { stdio: 'inherit', ...options });
}

const rootDir = path.resolve(__dirname, '..');

console.log('📥 Fetching WordPress plugin PHP dependencies...\n');

try {
  run(`node scripts/download-libs.js`, { cwd: rootDir });
} catch (error) {
  console.error('❌ Failed to download WordPress plugin libraries:', error.message);
  process.exit(1);
}

console.log('\n✅ WordPress libraries downloaded successfully!');
