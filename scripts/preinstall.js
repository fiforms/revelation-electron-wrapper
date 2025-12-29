const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const revelationDir = path.join(rootDir, 'revelation');
const nodeBin = process.execPath;

function run(command, options = {}) {
  execSync(command, { stdio: 'inherit', ...options });
}

console.log('📦 Installing Revelation GUI dependencies...');
run('npm install --omit=dev', { cwd: revelationDir });

console.log('🏗️  Building Revelation GUI...');
run('npm run build', { cwd: revelationDir });

console.log('🧩 Preparing plugins...');
run(`"${nodeBin}" scripts/copy-plugins.js`, { cwd: rootDir });
