// plugins/mathjax: mathjax-block.js (block parse/build/render, preprocess), the plugin's locale
// catalog, the `math` -> `mathjax` config migration and the offline export hook.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { pathToFileURL } = require('url');
const { installElectronStub } = require('./helpers/electron-stub');

installElectronStub();

const dir = path.join(__dirname, '..', 'plugins', 'mathjax');
const load = () => import(pathToFileURL(path.join(dir, 'mathjax-block.js')).href);
const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'locales', 'translations.json'), 'utf8'));
const parseYAML = (text) => yaml.load(text);

const SAMPLE = ':mathjax:\n  version: 4\n  formula: \\frac{a}{b}\n  display: inline\n  note: keep me';

test('parseMathjaxBlock reads formula and display and keeps unknown keys', async () => {
  const { parseMathjaxBlock } = await load();
  const parsed = parseMathjaxBlock(SAMPLE, yaml);
  assert.strictEqual(parsed.values.formula, '\\frac{a}{b}');
  assert.strictEqual(parsed.values.display, 'inline');
  assert.deepStrictEqual(parsed.extras, { note: 'keep me' });
});

test('parseMathjaxBlock defaults to block display and rejects bad YAML', async () => {
  const { parseMathjaxBlock } = await load();
  assert.strictEqual(parseMathjaxBlock(':mathjax:\n  formula: x', yaml).values.display, 'block');
  assert.strictEqual(parseMathjaxBlock(':mathjax:', yaml).values.formula, '');
  assert.strictEqual(parseMathjaxBlock(':mathjax:\n  formula: [unclosed', yaml), null);
  assert.strictEqual(parseMathjaxBlock(':mathjax:\n  - a', yaml), null);
});

test('buildMathjaxBlock writes version first, omits default display, and round-trips', async () => {
  const { parseMathjaxBlock, buildMathjaxBlock } = await load();
  const text = buildMathjaxBlock({ formula: ' x^2 ', display: 'block' }, yaml);
  assert.strictEqual(text, ':mathjax:\n  version: 4\n  formula: x^2');
  assert.strictEqual(buildMathjaxBlock({ formula: '  \n ', display: 'block' }, yaml), '');
  const parsed = parseMathjaxBlock(SAMPLE, yaml);
  const rebuilt = buildMathjaxBlock({ ...parsed.values, formula: 'y' }, yaml, parsed);
  assert.match(rebuilt, /display: inline/);
  assert.match(rebuilt, /note: keep me$/);
  assert.strictEqual(parseMathjaxBlock(rebuilt, yaml).values.formula, 'y');
});

test('every example and cheat-sheet code survives build -> parse unchanged', async () => {
  const { parseMathjaxBlock, buildMathjaxBlock, MATHJAX_EXAMPLES, MATHJAX_CHEATSHEET } = await load();
  const cases = [
    ...MATHJAX_EXAMPLES.map((e) => [e.formula, e.display]),
    ...MATHJAX_CHEATSHEET.map(([code]) => [code, 'block'])
  ];
  for (const [formula, display] of cases) {
    const parsed = parseMathjaxBlock(buildMathjaxBlock({ formula, display }, yaml, { indent: '  ' }), yaml);
    assert.strictEqual(parsed.values.formula, formula);
    assert.strictEqual(parsed.values.display, display);
    assert.strictEqual(parsed.indent, '  ');
  }
});

test('renderMathjaxHtml puts the formula in an escaped data-tex attribute', async () => {
  const { renderMathjaxHtml } = await load();
  assert.strictEqual(
    renderMathjaxHtml({ formula: 'a<b & "c"' }),
    '<div class="mathjax-formula mathjax-block" data-tex="a&lt;b &amp; &quot;c&quot;"></div>'
  );
  assert.strictEqual(renderMathjaxHtml({ formula: 'x', display: 'inline' }), '<span class="mathjax-formula mathjax-inline" data-tex="x"></span>');
  assert.strictEqual(renderMathjaxHtml({ formula: 'a\n\nb' }), '<div class="mathjax-formula mathjax-block" data-tex="a b"></div>');
  assert.strictEqual(renderMathjaxHtml({ formula: '  ' }), '');
  assert.strictEqual(renderMathjaxHtml(null), '');
});

test('preprocessMathjaxBlocks replaces blocks, keeps surrounding markdown and blank lines', async () => {
  const { preprocessMathjaxBlocks } = await load();
  const md = '# Title\n\n:mathjax:\n  version: 4\n  formula: E = mc^2\n\nAfter\n---\n:mathjax:\n  formula: x\n  display: inline\n';
  assert.strictEqual(
    preprocessMathjaxBlocks(md, parseYAML),
    '# Title\n\n<div class="mathjax-formula mathjax-block" data-tex="E = mc^2"></div>\n\nAfter\n---\n<span class="mathjax-formula mathjax-inline" data-tex="x"></span>\n'
  );
});

test('a block <div> is followed by a blank line so it cannot swallow the next markdown line', async () => {
  const { preprocessMathjaxBlocks } = await load();
  assert.strictEqual(
    preprocessMathjaxBlocks(':mathjax:\n  formula: x\n- item', parseYAML),
    '<div class="mathjax-formula mathjax-block" data-tex="x"></div>\n\n- item'
  );
});

test('formulas survive the markdown parser (backslashes, inline flow, following lines)', async () => {
  const { preprocessMathjaxBlocks } = await load();
  const { marked } = await import(pathToFileURL(path.join(__dirname, '..', 'revelation', 'node_modules', 'marked', 'lib', 'marked.esm.js')).href);
  const html = marked.parse(preprocessMathjaxBlocks(
    'Einstein showed\n:mathjax:\n  formula: E = \\frac{a}{b} \\\\ \\{c\\}\n  display: inline\nfor all.\n\n:mathjax:\n  formula: x < 0\n- item\n', parseYAML));
  assert.match(html, /<p>Einstein showed\n<span class="mathjax-formula mathjax-inline" data-tex="E = \\frac\{a\}\{b\} \\\\ \\\{c\\\}"><\/span>\nfor all\.<\/p>/);
  assert.match(html, /data-tex="x &lt; 0"><\/div>/);
  assert.match(html, /<ul>\s*<li>item<\/li>/);
});

test('typesetFormulas fills delimiters from data-tex once, including the root element itself', async () => {
  const { typesetFormulas } = await import(pathToFileURL(path.join(dir, 'mathjax-loader.js')).href);
  const make = (cls, tex) => {
    const attrs = new Map([['data-tex', tex]]);
    return {
      textContent: '', attrs,
      classList: { contains: (c) => cls.includes(c) },
      getAttribute: (k) => attrs.get(k), setAttribute: (k, v) => attrs.set(k, v),
      matches() { return !attrs.has('data-typeset'); }
    };
  };
  const inline = make(['mathjax-inline'], 'x^2');
  const block = make(['mathjax-block'], 'y');
  const root = { ...make([], ''), querySelectorAll: () => [inline, block], matches: () => false };
  let calls = 0;
  await typesetFormulas({ typesetPromise: async () => { calls += 1; } }, root);
  assert.strictEqual(inline.textContent, '\\(x^2\\)');
  assert.strictEqual(block.textContent, '\\[y\\]');
  inline.textContent = block.textContent = 'rendered';
  await typesetFormulas({ typesetPromise: async () => { calls += 1; } }, root);
  assert.strictEqual(inline.textContent, 'rendered');
  assert.strictEqual(calls, 2);
});

test('preprocessMathjaxBlocks leaves malformed blocks, other text and a missing parser alone', async () => {
  const { preprocessMathjaxBlocks } = await load();
  const bad = ':mathjax:\n  formula: [unclosed\nnext';
  assert.strictEqual(preprocessMathjaxBlocks(bad, parseYAML), bad);
  assert.strictEqual(preprocessMathjaxBlocks(SAMPLE, null), SAMPLE);
  assert.strictEqual(preprocessMathjaxBlocks('plain $$x$$ text', parseYAML), 'plain $$x$$ text');
  assert.strictEqual(preprocessMathjaxBlocks(':mathjax:\n\nnext', parseYAML), ':mathjax:\n\nnext');
});

test('locales file has an es catalog of strings', () => {
  assert.ok(catalog.es && typeof catalog.es === 'object');
  for (const [key, value] of Object.entries(catalog.es)) {
    assert.strictEqual(typeof value, 'string', key);
    assert.ok(value.trim(), key);
  }
});

test('every translated label is in the es catalog', async () => {
  const { MATHJAX_EXAMPLES, MATHJAX_CHEATSHEET } = await load();
  const keys = new Set([...MATHJAX_EXAMPLES.map((e) => e.label), ...MATHJAX_CHEATSHEET.map(([, d]) => d)]);
  for (const file of ['builder.js', 'client.js']) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/(?<![\w.$])tr\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin-manifest.json'), 'utf8'));
  assert.strictEqual(manifest.id, 'mathjax');
  keys.add(manifest.title);
  keys.add(manifest.description);
  const missing = [...keys].filter((key) => !(key in catalog.es));
  assert.deepStrictEqual(missing, []);
});

test('offline export copies every file client.js imports', async () => {
  const offline = require(path.join(dir, 'offline.js'));
  const result = await offline.export({ plugin: {}, pluginConfig: {} });
  const copied = result.copy.map((item) => item.from);
  const client = fs.readFileSync(path.join(dir, 'client.js'), 'utf8');
  for (const m of client.matchAll(/from '\.\/([^']+)'/g)) assert.ok(copied.includes(m[1]), m[1]);
  assert.ok(copied.includes('mathjax'));
  for (const item of result.copy.filter((c) => c.from !== 'mathjax')) assert.ok(fs.existsSync(path.join(dir, item.from)), item.from);
});

test('loadConfig renames an enabled `math` plugin to `mathjax` and drops its old settings', () => {
  const cm = require('../lib/configManager');
  fs.mkdirSync(path.dirname(cm.configPath), { recursive: true });
  fs.writeFileSync(cm.configPath, JSON.stringify({
    plugins: ['richbuilder', 'math', 'mathjax'],
    pluginConfigs: { math: { typesetter: 'katex' }, richbuilder: {} }
  }));
  const config = cm.loadConfig();
  assert.deepStrictEqual(config.plugins, ['richbuilder', 'mathjax']);
  assert.ok(!('math' in config.pluginConfigs));
  assert.ok('richbuilder' in config.pluginConfigs);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(cm.configPath, 'utf8')).plugins, ['richbuilder', 'mathjax']);
});
