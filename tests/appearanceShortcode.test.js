// plugins/appearance/builder.js: parseShortcode turns an existing fragment marker back into dialog fields
// (used when a fragment is clicked in the rich editor). The dialog itself needs a DOM and is not exercised here.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'plugins', 'appearance', 'builder.js')).href);

test('a bare ++ is a plain fragment (no animation)', async () => {
  const { parseShortcode } = await load();
  assert.deepStrictEqual(parseShortcode('++'), { trigger: '++', preset: '', split: '', speed: '', delay: '' });
});

test('full markers split into preset, split, speed and delay', async () => {
  const { parseShortcode } = await load();
  assert.deepStrictEqual(parseShortcode('++:bounce:let:slow:500'), { trigger: '++', preset: 'bounce', split: 'let', speed: 'slow', delay: '500' });
  assert.deepStrictEqual(parseShortcode('==:drop:fast'), { trigger: '==', preset: 'drop', split: '', speed: 'fast', delay: '' });
  assert.deepStrictEqual(parseShortcode('==:drop:slow:800'), { trigger: '==', preset: 'drop', split: '', speed: 'slow', delay: '800' });
});

test('modifiers without a preset are not mistaken for one', async () => {
  const { parseShortcode } = await load();
  assert.strictEqual(parseShortcode('++:slow').preset, '');
  assert.strictEqual(parseShortcode('++:slow').speed, 'slow');
});

test('splitDelays uses the delay as the gap between pieces, first piece immediate', async () => {
  const { splitDelays } = await load();
  assert.deepStrictEqual(splitDelays('ab c', 'let', 100).map((p) => p.delay), [0, 100, null, 200]);
  assert.deepStrictEqual(splitDelays('hi all', 'word').map((p) => p.delay), [0, null, 300]);
});
