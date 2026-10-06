// Shared path helpers and file walkers for the test suite.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function walk(dir, filter = () => true, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

function tmpDir(prefix = 'revelation-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

module.exports = { ROOT, walk, tmpDir, rel };
