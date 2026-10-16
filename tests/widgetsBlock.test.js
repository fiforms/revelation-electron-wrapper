// plugins/widgets/widget-block.js: parse and rebuild a `:widget:` block for the builder dialog;
// locales/translations.json covers every literal tr(...) key in the plugin's builder files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { pathToFileURL } = require('url');

const dir = path.join(__dirname, '..', 'plugins', 'widgets');
const load = () => import(pathToFileURL(path.join(dir, 'widget-block.js')).href);

const SAMPLE = ':widget:\n  name: calendar\n  position:\n    x: 0.03\n    y: 0.04\n  size:\n    w: 0.94\n    h: 0.9\n  parameters:\n    mode: month\n    color: "#ffffff"\n  note: keep me';

test('parseWidgetBlock reads layout and parameters and keeps unknown keys', async () => {
  const { parseWidgetBlock } = await load();
  const parsed = parseWidgetBlock(SAMPLE, yaml);
  assert.strictEqual(parsed.name, 'calendar');
  assert.deepStrictEqual([parsed.x, parsed.y, parsed.w, parsed.h], [0.03, 0.04, 0.94, 0.9]);
  assert.deepStrictEqual(parsed.parameters, { mode: 'month', color: '#ffffff' });
  assert.deepStrictEqual(parsed.extras, { note: 'keep me' });
});

test('parseWidgetBlock rejects other tags, bad YAML and non-mappings; handles indent', async () => {
  const { parseWidgetBlock } = await load();
  assert.strictEqual(parseWidgetBlock(':credits:\n  year: 1', yaml), null);
  assert.strictEqual(parseWidgetBlock(':widget:\n  name: [unclosed', yaml), null);
  assert.strictEqual(parseWidgetBlock(':widget:\n  - a', yaml), null);
  const indented = parseWidgetBlock('  :widget:\n    name: clock', yaml);
  assert.strictEqual(indented.name, 'clock');
  assert.strictEqual(indented.indent, '  ');
  assert.strictEqual(parseWidgetBlock(':widget:\n  name: clock', yaml).x, null);
});

test('buildWidgetBlock round-trips and omits empty sections', async () => {
  const { parseWidgetBlock, buildWidgetBlock } = await load();
  const parsed = parseWidgetBlock(SAMPLE, yaml);
  const rebuilt = buildWidgetBlock(parsed, yaml, { extras: parsed.extras, indent: parsed.indent });
  assert.deepStrictEqual(parseWidgetBlock(rebuilt, yaml), parsed);
  assert.strictEqual(buildWidgetBlock({ name: 'hello' }, yaml), ':widget:\n  name: hello');
});

test('buildWidgetBlock rounds ratios, writes location only when valid, and the result is a valid preprocessor block', async () => {
  const { parseWidgetBlock, buildWidgetBlock } = await load();
  const block = buildWidgetBlock({
    name: 'weather', x: 0.123456, y: 0, w: 0.5, h: 0.25,
    location: { name: ' Concord, NC ', latitude: '35.3762', longitude: '-80.541' },
    parameters: { zip: '28025' }
  }, yaml);
  const parsed = parseWidgetBlock(block, yaml);
  assert.strictEqual(parsed.x, 0.1235);
  assert.deepStrictEqual(parsed.location, { name: 'Concord, NC', latitude: 35.3762, longitude: -80.541 });
  assert.ok(!/location/.test(buildWidgetBlock({ name: 'weather', location: { latitude: '', longitude: '' } }, yaml)));
  // every body line is indented, as client.js preprocessMarkdown requires
  assert.ok(block.split('\n').slice(1).every((line) => /^ {2}/.test(line)));
});

test('locales file covers every literal tr() key in builder.js and client.js', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'locales', 'translations.json'), 'utf8'));
  const keys = new Set();
  for (const file of ['builder.js', 'client.js']) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/(?<![\w.$])tr\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]);
  }
  assert.ok(keys.size > 15);
  assert.deepStrictEqual([...keys].filter((key) => !(key in catalog.es)), []);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin-manifest.json'), 'utf8'));
  assert.ok(catalog.es[manifest.title]);
  assert.ok(catalog.es[manifest.description]);
});
