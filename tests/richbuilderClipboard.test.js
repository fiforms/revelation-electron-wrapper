// plugins/richbuilder/builder-clipboard.js: the pure paste routing (own / slides / inline / smart).
// The controller itself needs a DOM and is not exercised here.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'plugins', 'richbuilder', 'builder-clipboard.js')).href);
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

test('countContentLines ignores blank lines', async () => {
  const { countContentLines } = await load();
  assert.strictEqual(countContentLines('a\n\n  \nb\r\nc'), 3);
  assert.strictEqual(countContentLines(''), 0);
  assert.strictEqual(countContentLines(null), 0);
});

test('own markdown and slide payloads win over text', async () => {
  const { choosePasteRoute } = await load();
  assert.strictEqual(choosePasteRoute({ own: true, hasSlides: true, text: lines(20) }), 'own');
  assert.strictEqual(choosePasteRoute({ hasSlides: true, text: lines(20) }), 'slides');
});

test('8 lines or fewer paste inline, more go to Smart Paste', async () => {
  const { choosePasteRoute, PASTE_SMART_LINE_THRESHOLD } = await load();
  assert.strictEqual(PASTE_SMART_LINE_THRESHOLD, 8);
  assert.strictEqual(choosePasteRoute({ text: lines(8) }), 'inline');
  assert.strictEqual(choosePasteRoute({ text: lines(9) }), 'smart');
});

test('line count uses the filtered HTML text when there is HTML', async () => {
  const { choosePasteRoute } = await load();
  assert.strictEqual(choosePasteRoute({ text: 'x', htmlText: lines(12) }), 'smart');
  assert.strictEqual(choosePasteRoute({ text: lines(12), htmlText: 'short' }), 'inline');
  // HTML that filters to nothing falls back to the plain-text flavour.
  assert.strictEqual(choosePasteRoute({ text: lines(12), htmlText: '  ' }), 'smart');
});

test('empty clipboard routes to empty', async () => {
  const { choosePasteRoute } = await load();
  assert.strictEqual(choosePasteRoute({}), 'empty');
  assert.strictEqual(choosePasteRoute({ text: '  \n ', htmlText: '' }), 'empty');
});
