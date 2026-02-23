const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const revelationDir = path.join(rootDir, 'revelation');
const nodeBin = process.execPath;

// Abort if revelation/package.json does not exist
const fs = require('fs');
if (!fs.existsSync(path.join(revelationDir, 'package.json'))) {
  console.error('❌ Revelation submodule not found. Aborting preinstall script.');
  console.error('Please make sure to initialize and update git submodules:');
  console.error('  git submodule update --init --recursive');
  process.exit(1);
}

function run(command, options = {}) {
  execSync(command, { stdio: 'inherit', ...options });
}

console.log('📦 Installing Revelation GUI dependencies...');
run('npm install --omit=dev', { cwd: revelationDir });

console.log('🏗️  Building Revelation GUI...');
run('npm run build', { cwd: revelationDir });

console.log('🧩 Preparing plugins...');
run(`"${nodeBin}" scripts/copy-plugins.js`, { cwd: rootDir });

console.log('📦 Preparing offline plugin hooks...');
run(`"${nodeBin}" scripts/build-offline-plugins.js`, { cwd: rootDir });
