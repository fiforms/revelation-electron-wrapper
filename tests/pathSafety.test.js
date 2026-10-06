// lib/pathSafety.js: basename and containment checks for names that come from outside the app.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { isSafeBasename, assertSafeBasename, isSafeMediaFilename, assertSafeMediaFilename, resolveInside, resolvePresentationDir, resolvePresentationFile, isInside, slugify } = require('../lib/pathSafety');

test('isSafeBasename accepts plain names and rejects anything that is a path', () => {
  for (const ok of ['a.png', 'photo 1.JPG', 'abc123.highbitrate.h264.mp4', '..hidden', 'a..b', 'x'.repeat(255)]) {
    assert.ok(isSafeBasename(ok), ok);
  }
  const bad = ['', '.', '..', '../a.png', 'a/b.png', 'a\\b.png', '/etc/passwd', '..\\x', 'C:evil.png', 'c:\\x.png',
    'a\0b.png', 'x'.repeat(256), null, undefined, 5, {}, ['a.png']];
  for (const value of bad) assert.ok(!isSafeBasename(value), JSON.stringify(value));
});

test('assertSafeBasename returns the name or throws a readable error', () => {
  assert.strictEqual(assertSafeBasename('a.png'), 'a.png');
  assert.throws(() => assertSafeBasename('../a.png', 'media filename'), /Unsafe media filename/);
});

test('media filenames also refuse prohibited types, including trailing dot/space tricks', () => {
  for (const ok of ['a.png', 'clip.mp4', 'song.mp3', 'doc.pdf', 'logo.svg']) assert.ok(isSafeMediaFilename(ok), ok);
  for (const bad of ['a.html', 'a.exe', 'a.EXE', 'a.png.exe', 'a.exe.', 'a.exe ', 'a.zip', 'a.js', '../a.png']) {
    assert.ok(!isSafeMediaFilename(bad), bad);
  }
  assert.throws(() => assertSafeMediaFilename('a.html'), /not allowed/);
  assert.throws(() => assertSafeMediaFilename('../a.png'), /Unsafe/);
});

test('resolveInside returns paths strictly inside the base', () => {
  const base = path.resolve('/tmp/some-base');
  assert.strictEqual(resolveInside(base, 'a.png'), path.join(base, 'a.png'));
  assert.strictEqual(resolveInside(base, 'sub', 'a.png'), path.join(base, 'sub', 'a.png'));
  assert.strictEqual(resolveInside(base, '..hidden'), path.join(base, '..hidden'));
  for (const bad of ['..', '../x', 'sub/../../x', '', '.', '/etc/passwd', '../some-base-evil/x']) {
    assert.throws(() => resolveInside(base, bad), /escapes/, JSON.stringify(bad));
  }
});

test('resolvePresentationDir/File confine renderer-supplied slug and mdFile', () => {
  const root = path.resolve('/tmp/presentations');
  assert.strictEqual(resolvePresentationDir(root, 'my-deck'), path.join(root, 'my-deck'));
  assert.strictEqual(resolvePresentationFile(root, 'my-deck', 'presentation.md'), path.join(root, 'my-deck', 'presentation.md'));
  assert.strictEqual(resolvePresentationFile(root, 'my-deck', 'sub/alt.md'), path.join(root, 'my-deck', 'sub', 'alt.md'));
  for (const slug of ['..', '.', '', 'a/b', '../x', '/etc', 'a\\b', null, undefined, 5]) {
    assert.throws(() => resolvePresentationDir(root, slug), /Unsafe|not configured/, String(slug));
  }
  for (const md of ['../other/x.md', '../../etc/passwd', '/etc/passwd', '', null, undefined]) {
    assert.throws(() => resolvePresentationFile(root, 'my-deck', md), /escapes|not provided/, String(md));
  }
  assert.throws(() => resolvePresentationDir('', 'my-deck'), /not configured/);
});

test('isInside is strict: the base itself and siblings with a shared prefix are outside', () => {
  const base = path.resolve('/tmp/pres');
  assert.ok(isInside(base, path.join(base, 'a', 'b.md')));
  assert.ok(!isInside(base, base));
  assert.ok(!isInside(base, '/tmp/pres-evil/a.md'));
  assert.ok(!isInside(base, path.join(base, '..', 'x')));
});

test('slugify lowercases, collapses punctuation and trims hyphens', () => {
  assert.strictEqual(slugify('My First Talk!'), 'my-first-talk');
  assert.strictEqual(slugify('  --Hello___World--  '), 'hello-world');
  assert.strictEqual(slugify(null), '');
  assert.strictEqual(slugify(1234), '1234');
});
