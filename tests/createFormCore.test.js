// http_admin/create/metadata-form-core.js: the pure helpers of the Create / Edit Metadata form.
// The module is browser ESM that is import-safe in Node (no DOM access at import time).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const CORE = pathToFileURL(path.join(__dirname, '..', 'http_admin', 'create', 'metadata-form-core.js')).href;
const load = () => import(CORE);

test('slugify lowercases, collapses punctuation and trims dashes', async () => {
  const { slugify } = await load();
  assert.strictEqual(slugify('My First Talk!'), 'my-first-talk');
  assert.strictEqual(slugify('  --Hello___World--  '), 'hello-world');
  assert.strictEqual(slugify(''), '');
  assert.strictEqual(slugify(null), '');
  assert.strictEqual(slugify(undefined), '');
  assert.strictEqual(slugify(1234), '1234');
});

test('randomFourDigits returns four digits', async () => {
  const { randomFourDigits } = await load();
  for (let i = 0; i < 50; i++) assert.match(randomFourDigits(), /^[1-9]\d{3}$/);
});

test('coerceType handles boolean, number, integer and loose strings', async () => {
  const { coerceType } = await load();
  assert.strictEqual(coerceType('true', 'boolean'), true);
  assert.strictEqual(coerceType(true, 'boolean'), true);
  assert.strictEqual(coerceType('false', 'boolean'), false);
  assert.strictEqual(coerceType('1920', 'number'), 1920);
  assert.strictEqual(coerceType('0.5', 'number'), 0.5);
  assert.strictEqual(coerceType('12.9px', 'integer'), 12);
  assert.ok(Number.isNaN(coerceType('abc', 'integer')));
  assert.strictEqual(coerceType('true', 'text'), true);
  assert.strictEqual(coerceType('false', 'text'), false);
  assert.strictEqual(coerceType('null', 'text'), null);
  assert.strictEqual(coerceType('hello', 'text'), 'hello');
  assert.strictEqual(coerceType(5, 'text'), 5);
});

test('countMediaUsage counts media:alias references after the front matter only', async () => {
  const { countMediaUsage } = await load();
  const md = [
    '---', 'title: T', 'media:', '  intro: {filename: a.mp4}', '  bg: {filename: b.png}', '---',
    '![](media:intro)', 'again media: intro', 'MEDIA:Intro', 'no ref to bg here', 'media:introduction'
  ].join('\n');
  const counts = countMediaUsage(md, ['intro', 'bg', 'x.y']);
  // "media:introduction" also matches the "media:intro" prefix pattern (existing behavior)
  assert.deepStrictEqual(counts, { intro: 4, bg: 0, 'x.y': 0 });
  // Text inside the front matter is not counted, and no front matter means no content
  assert.deepStrictEqual(countMediaUsage('---\nmedia:intro\n---\n', ['intro']), { intro: 0 });
  assert.deepStrictEqual(countMediaUsage('media:intro', ['intro']), { intro: 0 });
  // Regex metacharacters in an alias are escaped
  assert.deepStrictEqual(countMediaUsage('---\nx: 1\n---\nmedia:a.b media:aXb', ['a.b']), { 'a.b': 1 });
});

test('getValidatedStructure keeps only non-default values, recursing into objects', async () => {
  const { getValidatedStructure } = await load();
  const schema = {
    title: { type: 'text', default: '' },
    theme: { type: 'select', default: 'black.css' },
    config: {
      type: 'object',
      fields: {
        width: { type: 'integer', default: 960 },
        loop: { type: 'boolean', default: false },
        transition: { type: 'select', default: 'slide' }
      }
    }
  };
  const input = { title: 'Hi', theme: 'black.css', 'config.width': '1920', 'config.loop': false, 'config.transition': 'slide' };
  assert.deepStrictEqual(getValidatedStructure(schema, input), { title: 'Hi', config: { width: 1920 } });
  // Missing inputs fall back to the default and so are omitted
  assert.deepStrictEqual(getValidatedStructure(schema, {}), { config: {} });
});

test('t/tf use window.tr when present and fill placeholders', async () => {
  const { t, tf } = await load();
  assert.strictEqual(t('Hello'), 'Hello');
  assert.strictEqual(tf('Add {name} x{n}', { name: 'cat', n: 2 }), 'Add cat x2');
});

test('formState and the field-builder registry', async () => {
  const { formState, markDirty, registerFieldBuilder, getFieldBuilder } = await load();
  assert.strictEqual(formState.formDirty, false);
  markDirty();
  assert.strictEqual(formState.formDirty, true);
  formState.formDirty = false;
  assert.throws(() => getFieldBuilder('nope'), /No field builder/);
  const fn = () => 1;
  registerFieldBuilder('unit-test', fn);
  assert.strictEqual(getFieldBuilder('unit-test'), fn);
});
