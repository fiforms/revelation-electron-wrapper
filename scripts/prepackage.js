const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const revelationDir = path.join(rootDir, 'revelation');
const presentationsPrefix = 'presentations_';
const pluginsBibletextDir = path.join(rootDir, 'plugins.bibletext', 'bibles');

function safeRemove(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function removePresentationDirs() {
  if (!fs.existsSync(revelationDir)) {
    return;
  }
  const entries = fs.readdirSync(revelationDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (!entry.name.startsWith(presentationsPrefix)) {
      continue;
    }
    safeRemove(path.join(revelationDir, entry.name));
  }
}

function removeBibleJsonFiles() {
  if (!fs.existsSync(pluginsBibletextDir)) {
    return;
  }
  const entries = fs.readdirSync(pluginsBibletextDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    safeRemove(path.join(pluginsBibletextDir, entry.name));
  }
}

console.log('🧹 Cleaning packaging artifacts...');
removePresentationDirs();
removeBibleJsonFiles();
