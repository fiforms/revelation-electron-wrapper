// plugins/credit_ccli/credits-block.js: parse and rebuild a `:credits:` block for the builder dialog.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const yaml = require('js-yaml');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'plugins', 'credit_ccli', 'credits-block.js')).href);

const SAMPLE = ':credits:\n  words: Ron Hamilton\n  music: Ron Hamilton\n  year: 1981\n  copyright: Majesty Music\n  cclisong: 72439\n  license: ccli\n  mood: joyful';

test('parseCreditsBlock reads known keys as strings and keeps unknown keys', async () => {
  const { parseCreditsBlock } = await load();
  const parsed = parseCreditsBlock(SAMPLE, yaml);
  assert.strictEqual(parsed.values.year, '1981');
  assert.strictEqual(parsed.values.cclisong, '72439');
  assert.strictEqual(parsed.values.license, 'ccli');
  assert.deepStrictEqual(parsed.extras, { mood: 'joyful' });
});

test('parseCreditsBlock handles empty blocks, attrib flags, and rejects bad YAML', async () => {
  const { parseCreditsBlock } = await load();
  assert.deepStrictEqual(parseCreditsBlock(':credits:', yaml).values, {});
  assert.strictEqual(parseCreditsBlock(':credits:\n  attrib: yes', yaml).values.attrib, true);
  assert.strictEqual(parseCreditsBlock(':credits:\n  words: [unclosed', yaml), null);
  assert.strictEqual(parseCreditsBlock(':credits:\n  - a\n  - b', yaml), null);
});

test('buildCreditsBlock drops empty fields, writes numbers plainly, and round-trips', async () => {
  const { parseCreditsBlock, buildCreditsBlock } = await load();
  const parsed = parseCreditsBlock(SAMPLE, yaml);
  const text = buildCreditsBlock({ ...parsed.values, music: '', source: ' ' }, yaml, parsed);
  assert.match(text, /^:credits:\n {2}words: Ron Hamilton\n {2}year: 1981\n/);
  assert.ok(!/music|source/.test(text));
  assert.match(text, /\n {2}mood: joyful$/);
  assert.deepStrictEqual(parseCreditsBlock(text, yaml).values.words, 'Ron Hamilton');
});

test('buildCreditsBlock keeps the original indent and quotes awkward values', async () => {
  const { parseCreditsBlock, buildCreditsBlock } = await load();
  const text = buildCreditsBlock({ words: 'A: B #1', license: 'public', attrib: true }, yaml, { indent: '  ' });
  assert.ok(text.startsWith('  :credits:\n    '));
  assert.strictEqual(parseCreditsBlock(text, yaml).values.words, 'A: B #1');
  assert.strictEqual(parseCreditsBlock(text, yaml).values.attrib, true);
});
