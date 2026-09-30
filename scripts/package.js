// Prune the tree, run electron-builder, then restore everything that was pruned.
// Usage: node scripts/package.js <electron-builder args>   e.g. --win
const path = require('path');
const { spawn } = require('child_process');
const { run: prepackage } = require('./prepackage');
const { restoreAll } = require('./package-stash');

const rootDir = path.resolve(__dirname, '..');
const builderArgs = process.argv.slice(2);

let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  console.log('♻️  Restoring pruned files to the working tree...');
  const n = restoreAll();
  console.log(`✅ Restored ${n} item(s).`);
}

function runBuilder() {
  return new Promise((resolve) => {
    const bin = path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
    const child = spawn(bin, builderArgs, { cwd: rootDir, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', (err) => { console.error('❌ Could not start electron-builder:', err.message); resolve(1); });
    child.on('close', (code) => resolve(code === null ? 1 : code));
  });
}

// Ctrl+C: let electron-builder (same process group) stop, then restore.
process.on('SIGINT', () => { restore(); process.exit(130); });
process.on('SIGTERM', () => { restore(); process.exit(143); });

(async () => {
  let code = 1;
  try {
    await prepackage();
    code = await runBuilder();
  } catch (err) {
    console.error('❌ Packaging failed:', err.message);
  } finally {
    restore();
  }
  process.exit(code);
})();
