// lib/escapeHtml.js and its browser twin revelation/js/escape.js: both encode & < > " ' and agree.
const test = require('node:test');
const assert = require('node:assert');
const { escapeHTML } = require('../lib/escapeHtml');

test('escapeHTML encodes all five characters, so output is safe in text and in quoted attributes', () => {
  assert.strictEqual(escapeHTML(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
  assert.strictEqual(escapeHTML('" onerror="alert(1)'), '&quot; onerror=&quot;alert(1)');
});

test('escapeHTML turns null/undefined into "" and other values into text', () => {
  assert.strictEqual(escapeHTML(null), '');
  assert.strictEqual(escapeHTML(undefined), '');
  assert.strictEqual(escapeHTML(42), '42');
});

test('lib/escapeHtml.js and revelation/js/escape.js agree (keep the twins in sync)', async () => {
  const esm = await import('../revelation/js/escape.js');
  for (const sample of ['', 'plain', `&<>"'`, '"><img src=x onerror=1>', null, undefined, 0, 'a&amp;b']) {
    assert.strictEqual(esm.escapeHTML(sample), escapeHTML(sample), String(sample));
  }
});
