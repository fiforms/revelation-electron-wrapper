// plugins/revealchart/chart-block.js: parse and rebuild a `:chart:` block for the builder dialog.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const yaml = require('js-yaml');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'plugins', 'revealchart', 'chart-block.js')).href);

const SAMPLE = [
  ':chart:',
  '  items:',
  '    - type: line',
  '      height: 300px',
  '      data:',
  '        labels: [Jan, Feb]',
  '        datasets:',
  '          - label: Attendance',
  '            borderColor: "#ff0000"',
  '            data: [12, 19]',
  '      options:',
  '        responsive: true',
  '        plugins:',
  '          tooltip:',
  '            mode: index'
].join('\n');

test('parseChartBlock reads the three block shapes', async () => {
  const { parseChartBlock } = await load();
  const a = parseChartBlock(SAMPLE, yaml);
  assert.strictEqual(a.shape, 'items');
  assert.strictEqual(a.items.length, 1);
  assert.strictEqual(a.items[0].type, 'line');
  assert.strictEqual(parseChartBlock(':chart:\n  - type: bar\n  - type: pie', yaml).shape, 'array');
  const single = parseChartBlock(':chart:\n  type: pie', yaml);
  assert.strictEqual(single.shape, 'single');
  assert.deepStrictEqual(single.items, [{ type: 'pie' }]);
  assert.deepStrictEqual(parseChartBlock(':chart:', yaml).items, []);
});

test('parseChartBlock rejects bad YAML and non-chart content', async () => {
  const { parseChartBlock } = await load();
  assert.strictEqual(parseChartBlock(':chart:\n  type: [unclosed', yaml), null);
  assert.strictEqual(parseChartBlock(':chart:\n  - just text', yaml), null);
  assert.strictEqual(parseChartBlock(':table:\n  datasource: a.csv', yaml), null);
});

test('buildChartBlock round-trips unknown keys, options and the source shape', async () => {
  const { parseChartBlock, buildChartBlock } = await load();
  const parsed = parseChartBlock(SAMPLE, yaml);
  const text = buildChartBlock(parsed.items, yaml, parsed);
  assert.deepStrictEqual(parseChartBlock(text, yaml).items, parsed.items);
  assert.match(text, /^:chart:\n {2}items:\n/);
  const single = parseChartBlock(':chart:\n  type: pie\n  selector: "#c1"', yaml);
  assert.strictEqual(buildChartBlock(single.items, yaml, single), ':chart:\n  type: pie\n  selector: \'#c1\'');
  const indented = parseChartBlock('  :chart:\n    type: pie', yaml);
  assert.match(buildChartBlock(indented.items, yaml, indented), /^ {2}:chart:\n {4}type: pie$/);
  assert.strictEqual(buildChartBlock([], yaml), ':chart:');
});

test('path helpers set, read and prune empty parents', async () => {
  const { getPath, setPath, unsetPath } = await load();
  const item = {};
  setPath(item, 'options.plugins.title.text', 'Hi');
  assert.strictEqual(getPath(item, 'options.plugins.title.text'), 'Hi');
  setPath(item, 'options.responsive', true);
  unsetPath(item, 'options.plugins.title.text');
  assert.deepStrictEqual(item, { options: { responsive: true } });
  assert.strictEqual(getPath(item, 'options.nope.deeper'), undefined);
});

test('COMMON_OPTIONS write and remove their own keys only', async () => {
  const { COMMON_OPTIONS } = await load();
  const by = (id) => COMMON_OPTIONS.find((o) => o.id === id);
  const item = { type: 'bar', options: { responsive: true } };
  by('title').set(item, 'Sales');
  by('stacked').set(item, true);
  by('legend').set(item, 'hidden');
  assert.strictEqual(by('title').get(item), 'Sales');
  assert.strictEqual(by('stacked').get(item), true);
  assert.strictEqual(by('legend').get(item), 'hidden');
  by('title').set(item, '');
  by('stacked').set(item, false);
  by('legend').set(item, '');
  assert.deepStrictEqual(item, { type: 'bar', options: { responsive: true } });
});

test('deepMerge merges objects and replaces arrays', async () => {
  const { deepMerge, SNIPPETS } = await load();
  const item = { options: { scales: { y: { beginAtZero: true } } } };
  deepMerge(item, SNIPPETS.find((s) => s.id === 'logScale').patch);
  assert.deepStrictEqual(item.options.scales.y, { beginAtZero: true, type: 'logarithmic' });
  assert.deepStrictEqual(deepMerge({ a: [1, 2] }, { a: [3] }), { a: [3] });
});

test('grid conversion keeps dataset styling and handles pasted spreadsheet text', async () => {
  const { gridFromData, applyGridToData, gridFromText } = await load();
  const data = { labels: ['A', 'B'], datasets: [{ label: 'X', backgroundColor: 'red', data: [1, 2] }] };
  const grid = gridFromData(data);
  assert.deepStrictEqual(grid, { header: ['X'], rows: [['A', 1], ['B', 2]] });
  grid.rows[1][1] = '5';
  grid.header.push('Y');
  grid.rows[0].push('7');
  grid.rows[1].push('');
  const next = applyGridToData(data, grid);
  assert.strictEqual(next.datasets[0].backgroundColor, 'red');
  assert.deepStrictEqual(next.datasets[0].data, [1, 5]);
  assert.deepStrictEqual(next.datasets[1], { label: 'Y', data: [7, null] });
  assert.strictEqual(gridFromData({ datasets: [{ data: [{ x: 1, y: 2 }] }] }), null);

  const tsv = gridFromText('Month\tSales\tCosts\nJan\t10\t4\nFeb\t12\t5');
  assert.deepStrictEqual(tsv, { header: ['Sales', 'Costs'], rows: [['Jan', 10, 4], ['Feb', 12, 5]] });
  assert.deepStrictEqual(gridFromText('m,v\na,1').rows, [['a', 1]]);
  assert.strictEqual(gridFromText('just one cell'), null);
});
