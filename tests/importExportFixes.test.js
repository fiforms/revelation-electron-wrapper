// Regression tests for the import/export correctness fixes (doc/dev/KNOWN_ISSUES.md history):
// markdown collection skips backups, thumbnails of both formats are exported, the media scanner
// tolerates null entries and counts large variants.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { installElectronStub } = require('./helpers/electron-stub');
const { tmpDir } = require('./helpers/paths');

installElectronStub();

const { collectMarkdownFilesRecursive, copyMediaForExport } = require('../lib/exportPresentation');
const { scanAllPresentations } = require('../lib/mediaUsageScanner');

test('collectMarkdownFilesRecursive skips dot-dirs and _resources', () => {
  const dir = tmpDir();
  for (const d of ['.sync-conflicts', '_resources', 'sub']) fs.mkdirSync(path.join(dir, d));
  for (const f of ['presentation.md', '.sync-conflicts/old.md', '_resources/x.md', 'sub/two.md', '__builder_temp.md']) {
    fs.writeFileSync(path.join(dir, f), '# hi');
  }
  assert.deepStrictEqual(collectMarkdownFilesRecursive(dir), ['presentation.md', 'sub/two.md']);
});

test('copyMediaForExport copies .jpg and .webp thumbnails', () => {
  const src = tmpDir();
  const dest = tmpDir();
  fs.writeFileSync(path.join(src, 'a.png'), 'x');
  fs.writeFileSync(path.join(src, 'a.png.thumbnail.jpg'), 'j');
  fs.writeFileSync(path.join(src, 'b.png'), 'x');
  fs.writeFileSync(path.join(src, 'b.png.thumbnail.webp'), 'w');
  copyMediaForExport(new Set(['a.png', 'b.png']), src, dest);
  assert.deepStrictEqual(fs.readdirSync(dest).sort(), ['a.png', 'a.png.thumbnail.jpg', 'b.png', 'b.png.thumbnail.webp']);
});

test('scanAllPresentations tolerates null media entries and counts large variants', async () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'p'));
  fs.writeFileSync(path.join(root, 'p', 'presentation.md'),
    '---\nmedia:\n  a: null\n  b:\n    filename: small.mp4\n    large_variant:\n      filename: big.mp4\n---\n\n![](pic.avif)\n');
  try { fs.symlinkSync(path.join(root, 'missing'), path.join(root, 'broken')); } catch {}
  const used = await scanAllPresentations(root);
  for (const name of ['small.mp4', 'big.mp4', 'pic.avif']) assert.ok(used.has(name), name);
});
