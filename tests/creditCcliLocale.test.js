// plugins/credit_ccli: locales/translations.json is valid and covers every literal translation key.
// Keys are collected by regex from tr(...) calls in the plugin's *.js files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'plugins', 'credit_ccli');
const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'locales', 'translations.json'), 'utf8'));

function collectKeys() {
  const keys = new Set();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/(?<![\w.$])t[fr]?\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]);
  }
  return keys;
}

test('locales file has an es catalog of strings', () => {
  assert.ok(catalog.es && typeof catalog.es === 'object');
  for (const [key, value] of Object.entries(catalog.es)) {
    assert.strictEqual(typeof value, 'string', key);
    assert.ok(value.trim(), key);
  }
});

test('every literal t()/tf() key is translated', () => {
  const keys = collectKeys();
  assert.ok(keys.size > 10);
  const missing = [...keys].filter((key) => !(key in catalog.es));
  assert.deepStrictEqual(missing, []);
});

test('manifest title and description are translated', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin-manifest.json'), 'utf8'));
  assert.ok(catalog.es[manifest.title]);
  assert.ok(catalog.es[manifest.description]);
});
