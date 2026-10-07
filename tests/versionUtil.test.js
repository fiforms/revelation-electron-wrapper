// lib/versionUtil.js: note-separator version rule, cross-checked against the ESM twin in
// revelation/js/compiler/compiler-utils.js (browser + builder).
const test = require('node:test');
const assert = require('node:assert');
const v = require('../lib/versionUtil');

const VERSIONS = ['', undefined, null, 'abc', '0.2.5', '0.2.6', 'v0.2.6', '0.2.7', '0.3.0', '1.0.0', '0.2.6-beta', '10.0.0'];

test('note-version rule: legacy up to and including 0.2.6, new above, unversioned is legacy', () => {
  assert.strictEqual(v.isLegacyNoteVersion('0.2.6'), true);
  assert.strictEqual(v.isNewNoteVersion('0.2.6'), false);
  assert.strictEqual(v.isNewNoteVersion('0.2.7'), true);
  assert.strictEqual(v.isLegacyNoteVersion(undefined), true);
  assert.strictEqual(v.isNewNoteVersion(undefined), false);
  assert.deepStrictEqual(v.parseSemverTuple('v1.2.3'), [1, 2, 3]);
  assert.strictEqual(v.compareVersionTuples([1, 0, 0], [0, 9, 9]), 1);
});

test('normalizeNoteSeparators rewrites only whole-line "Note:" and keeps line endings readable', () => {
  assert.strictEqual(v.normalizeNoteSeparators('a\nNote:\nb\n  Note:  \nNote: inline\r\nNote:'), 'a\n:note:\nb\n:note:\nNote: inline\n:note:');
});

test('lib/versionUtil.js and compiler-utils.js agree (keep the twins in sync)', async () => {
  const esm = await import('../revelation/js/compiler/compiler-utils.js');
  assert.deepStrictEqual(esm.NOTE_VERSION_BREAKPOINT, v.NOTE_VERSION_BREAKPOINT);
  for (const version of VERSIONS) {
    assert.strictEqual(esm.isNewNoteVersion(version), v.isNewNoteVersion(version), String(version));
    assert.strictEqual(esm.isLegacyNoteVersion(version), v.isLegacyNoteVersion(version), String(version));
    assert.deepStrictEqual(esm.parseSemverTuple(version), v.parseSemverTuple(version), String(version));
  }
  const sample = 'one\nNote:\ntwo\r\n Note: \nNote: x';
  assert.strictEqual(esm.normalizeNoteSeparators(sample), v.normalizeNoteSeparators(sample));
});
