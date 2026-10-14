// Guards the slidesorter Spanish catalog: valid JSON with an `es` object, and every literal
// t('...') / tf('...') / menuItem('...') key in the plugin's browser modules
// has an entry, so new strings are not forgotten.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'plugins', 'slidesorter');
const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'locales', 'translations.json'), 'utf8'));

function literalKeys() {
  const keys = new Set();
  const callRe = /\bt[f]?\(\s*'((?:[^'\\]|\\.)*)'/g;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'translate.js')) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    let m;
    while ((m = callRe.exec(src))) keys.add(m[1].replace(/\\'/g, "'"));
    // menuItem(key) and menuItem(cond ? 'a' : 'b', vars): collect the quoted keys before the vars.
    const menuRe = /\.\.\.menuItem\(([^{)]*)/g;
    while ((m = menuRe.exec(src))) {
      for (const q of m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) keys.add(q[1]);
    }
  }
  return keys;
}

test('slidesorter locales file has an es catalog', () => {
  assert.equal(typeof catalog.es, 'object');
  for (const [k, v] of Object.entries(catalog.es)) {
    assert.equal(typeof v, 'string', k);
    assert.ok(v.trim(), `empty translation for "${k}"`);
  }
});

test('every literal t()/tf() key has a Spanish entry', () => {
  const keys = literalKeys();
  assert.ok(keys.size > 20);
  const missing = [...keys].filter((k) => !(k in catalog.es));
  assert.deepEqual(missing, []);
});

test('manifest strings are translated', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin-manifest.json'), 'utf8'));
  assert.ok(manifest.title in catalog.es);
  assert.ok(manifest.description in catalog.es);
});
