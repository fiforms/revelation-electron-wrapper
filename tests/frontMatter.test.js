// lib/frontMatter.js: the shared front-matter splitter/parser.
const test = require('node:test');
const assert = require('node:assert');
const { splitFrontMatter, parseFrontMatter } = require('../lib/frontMatter');

test('splitFrontMatter: block + body reassemble the text, LF and CRLF', () => {
  for (const nl of ['\n', '\r\n']) {
    const text = `---${nl}title: Hi${nl}---${nl}# Slide${nl}`;
    const out = splitFrontMatter(text);
    assert.ok(out.hasFrontMatter);
    assert.strictEqual(out.yamlText, 'title: Hi');
    assert.strictEqual(out.block + out.body, text);
    assert.strictEqual(out.body, `# Slide${nl}`);
  }
});

test('splitFrontMatter: no fence at the start means no front matter', () => {
  for (const text of ['# Slide\n---\nx: 1\n---\n', ' ---\na: 1\n---\n', '', null, undefined]) {
    const out = splitFrontMatter(text);
    assert.strictEqual(out.hasFrontMatter, false);
    assert.strictEqual(out.block, '');
    assert.strictEqual(out.body, String(text ?? ''));
  }
});

test('parseFrontMatter: data is always an object; malformed is flagged, not thrown', () => {
  assert.deepStrictEqual(parseFrontMatter('---\ntitle: Hi\n---\nbody').data, { title: 'Hi' });
  assert.deepStrictEqual(parseFrontMatter('---\n# only a comment\n---\nbody').data, {});
  assert.deepStrictEqual(parseFrontMatter('---\n- a\n- b\n---\nbody').data, {});
  assert.deepStrictEqual(parseFrontMatter('plain text').data, {});
  const bad = parseFrontMatter('---\na: [unclosed\n---\nbody');
  assert.strictEqual(bad.malformed, true);
  assert.ok(bad.error instanceof Error);
  assert.deepStrictEqual(bad.data, {});
  assert.strictEqual(bad.body, 'body');
});

test('parseFrontMatter: "---" inside a YAML value does not end the block', () => {
  const out = parseFrontMatter('---\ntitle: a --- b\nmedia:\n  x:\n    filename: f.png\n---\nbody');
  assert.strictEqual(out.data.title, 'a --- b');
  assert.strictEqual(out.data.media.x.filename, 'f.png');
});

test('mediaUsageScanner.extractUsedMedia reads media from the real front matter, CRLF included', () => {
  const { extractUsedMedia } = require('../lib/mediaUsageScanner');
  const used = new Set();
  extractUsedMedia('---\r\ntitle: a --- b\r\nmedia:\r\n  x:\r\n    filename: one.png\r\n    large_variant:\r\n      filename: one.big.mp4\r\n---\r\n![](two.jpg)\r\n', used);
  assert.deepStrictEqual([...used].sort(), ['one.big.mp4', 'one.png', 'two.jpg']);
});

test('lib/frontMatter.js and revelation/js/frontmatter.js split identically (keep the twins in sync)', async () => {
  const { splitFrontMatter: browserSplit } = await import('../revelation/js/frontmatter.js');
  const samples = [
    '---\ntitle: Hi\n---\n# Slide\n', '---\r\ntitle: Hi\r\n---\r\nbody', '---\n---\nbody', '# no fm\n---\nx: 1\n---\n',
    '---\na: 1\n---', '', '---\ntitle: a --- b\n---\nbody', '--- \na: 1\n---\n'
  ];
  for (const text of samples) {
    assert.deepStrictEqual(browserSplit(text), splitFrontMatter(text), JSON.stringify(text));
  }
});
