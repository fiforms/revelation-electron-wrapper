// plugins/revealchart/table-block.js: parse and rebuild a `:table:` block for the builder dialog.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const yaml = require('js-yaml');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'plugins', 'revealchart', 'table-block.js')).href);

const SAMPLE = [
  ':table:',
  '  datasource: attendance.csv',
  '  class: darktable',
  '  headerRow: 1',
  '  alignColumns:',
  '    C: right',
  '  formatColumns:',
  '    C: currency',
  '  summarizeColumns:',
  '    C: sum',
  '  mood: kept'
].join('\n');

test('parseTableBlock and buildTableBlock round-trip, keeping unknown keys', async () => {
  const { parseTableBlock, buildTableBlock } = await load();
  const parsed = parseTableBlock(SAMPLE, yaml);
  assert.strictEqual(parsed.shape, 'single');
  const text = buildTableBlock(parsed.items, yaml, parsed);
  assert.match(text, /^:table:\n {2}datasource: attendance\.csv\n/);
  assert.deepStrictEqual(parseTableBlock(text, yaml).items, parsed.items);
  assert.strictEqual(parseTableBlock(':chart:\n  type: pie', yaml), null);
  assert.strictEqual(parseTableBlock(':table:\n  a: [unclosed', yaml), null);
});

test('datasource file helpers keep the object form and its key', async () => {
  const { getDatasourceFile, setDatasourceFile } = await load();
  const plain = { datasource: 'a.csv' };
  setDatasourceFile(plain, ' b.csv ');
  assert.deepStrictEqual(plain, { datasource: 'b.csv' });
  setDatasourceFile(plain, '');
  assert.deepStrictEqual(plain, {});
  const obj = { datasource: { path: 'a.csv', series: 'row-series' } };
  setDatasourceFile(obj, 'c.csv');
  assert.deepStrictEqual(obj.datasource, { path: 'c.csv', series: 'row-series' });
  assert.strictEqual(getDatasourceFile(obj), 'c.csv');
  assert.strictEqual(getDatasourceFile({}), '');
});

test('setField drops empty values and writes headerRow as a number', async () => {
  const { TABLE_FIELDS, setField, getField, setIncludeHeader, getIncludeHeader } = await load();
  const by = (key) => TABLE_FIELDS.find((f) => f.key === key);
  const item = {};
  setField(item, by('headerRow'), '2');
  setField(item, by('height'), ' 320px ');
  assert.deepStrictEqual(item, { headerRow: 2, height: '320px' });
  assert.strictEqual(getField(item, by('headerRow')), '2');
  setField(item, by('height'), '');
  assert.deepStrictEqual(item, { headerRow: 2 });
  setIncludeHeader(item, false);
  assert.strictEqual(getIncludeHeader(item), false);
  setIncludeHeader(item, true);
  assert.ok(!('includeHeader' in item));
});

test('column rules merge the three maps and write them back', async () => {
  const { parseTableBlock, columnRules, applyColumnRules } = await load();
  const item = parseTableBlock(SAMPLE, yaml).items[0];
  const rules = columnRules(item);
  assert.deepStrictEqual(rules, [{ column: 'C', align: 'right', format: 'currency', summarize: 'sum' }]);
  rules[0].summarize = '';
  rules.push({ column: 'D', align: '', format: 'percentage', summarize: '' }, { column: '', align: 'left', format: '', summarize: '' });
  applyColumnRules(item, rules);
  assert.deepStrictEqual(item.alignColumns, { C: 'right' });
  assert.deepStrictEqual(item.formatColumns, { C: 'currency', D: 'percentage' });
  assert.ok(!('summarizeColumns' in item));
  assert.strictEqual(item.mood, 'kept');
});

test('columnRules gives up on the list form and alias keys', async () => {
  const { columnRules } = await load();
  assert.strictEqual(columnRules({ alignColumns: [{ column: 'C', value: 'right' }] }), null);
  assert.strictEqual(columnRules({ columnAlign: { C: 'right' } }), null);
  assert.deepStrictEqual(columnRules({}), []);
});
