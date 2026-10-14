// Guards the richbuilder Spanish catalog: valid JSON with an `es` object, and every literal
// t('...') / tf('...') key in the plugin's browser modules (plus the layout preset labels,
// which are translated at render time) has an entry, so new strings are not forgotten.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'plugins', 'richbuilder');
const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'locales', 'translations.json'), 'utf8'));

function literalKeys() {
  const keys = new Set();
  const callRe = /\bt[f]?\(\s*'((?:[^'\\]|\\.)*)'/g;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'translate.js')) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    let m;
    while ((m = callRe.exec(src))) keys.add(m[1].replace(/\\'/g, "'"));
    if (file === 'builder-layout.js') {
      const labelRe = /^\s*label:\s*'([^']+)'/gm;
      while ((m = labelRe.exec(src))) keys.add(m[1]);
    }
  }
  return keys;
}

test('richbuilder locales file has an es catalog', () => {
  assert.equal(typeof catalog.es, 'object');
  for (const [k, v] of Object.entries(catalog.es)) {
    assert.equal(typeof v, 'string', k);
    assert.ok(v.trim(), `empty translation for "${k}"`);
  }
});

test('every literal t()/tf() key has a Spanish entry', () => {
  const keys = literalKeys();
  assert.ok(keys.size > 50);
  const missing = [...keys].filter((k) => !(k in catalog.es));
  assert.deepEqual(missing, []);
});

test('manifest strings are translated', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin-manifest.json'), 'utf8'));
  assert.ok(manifest.title in catalog.es);
  assert.ok(manifest.description in catalog.es);
});
