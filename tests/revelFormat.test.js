// .revel archive rules (doc/dev/REVEL_FORMAT.md): what may be packed or extracted, SVG
// sanitizing, zip-slip protection, and a full pack/extract round trip on a temp folder.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const rf = require('../lib/revelFormat');
const { tmpDir } = require('./helpers/paths');
const { rawZip } = require('./helpers/raw-zip');

test('isProhibitedName blocks code, macro Office files and archives, including disguises', () => {
  for (const name of ['a.html', 'x/y.JS', 'run.exe', 'photo.jpg.exe', 'a.exe.', 'a.exe ', 'b.docm', 'c.zip', 'd.tar.gz']) {
    assert.ok(rf.isProhibitedName(name), name);
  }
  for (const name of ['slides.md', 'pic.png', 'talk.pdf', 'deck.pptx', 'doc.docx', 'noext']) {
    assert.ok(!rf.isProhibitedName(name), name);
  }
});

test('prohibitionReason sniffs content for executables and archives hidden behind media names', () => {
  assert.match(rf.prohibitionReason('x.png', Buffer.from('MZ\x90\x00')), /executable/);
  assert.match(rf.prohibitionReason('x.pdf', Buffer.from('#!/bin/sh')), /executable/);
  assert.match(rf.prohibitionReason('x.mp3', Buffer.from([0x50, 0x4b, 3, 4])), /archive/);
  assert.strictEqual(rf.prohibitionReason('x.docx', Buffer.from([0x50, 0x4b, 3, 4])), '', 'docx is a legitimate ZIP');
  assert.strictEqual(rf.prohibitionReason('notes.md', Buffer.from('#!shebang-looking text')), '');
  assert.strictEqual(rf.prohibitionReason('x.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])), '');
});

test('isUnsafeEntryName rejects traversal and absolute paths', () => {
  for (const name of ['../evil', 'a/../../b', '/etc/passwd', 'C:\\x', 'c:/x', '']) {
    assert.ok(rf.isUnsafeEntryName(name), JSON.stringify(name));
  }
  assert.ok(!rf.isUnsafeEntryName('_media/pic.png'));
  assert.ok(!rf.isUnsafeEntryName('a..b/c'));
});

test('hasHiddenSegment / needsOriginMark', () => {
  assert.ok(rf.hasHiddenSegment('.thumbs/a.png'));
  assert.ok(rf.hasHiddenSegment('a/.git/config'));
  assert.ok(!rf.hasHiddenSegment('a/b.png'));
  assert.ok(rf.needsOriginMark('talk.pdf'));
  assert.ok(rf.needsOriginMark('deck.pptx'));
  assert.ok(!rf.needsOriginMark('pic.png'));
  assert.ok(!rf.needsOriginMark('slides.md'));
});

test('compareVersions orders dotted versions', () => {
  assert.ok(rf.compareVersions('1.0.13', '1.0.9') > 0);
  assert.ok(rf.compareVersions('1.0.0', '1.0.1') < 0);
  assert.strictEqual(rf.compareVersions('2.0.0', '2.0.0'), 0);
  assert.ok(rf.compareVersions('1.2', '1.1.9') > 0);
  assert.ok(rf.compareVersions('', '0.0.1') < 0);
  assert.ok(rf.compareVersions(undefined, '0.0.0') === 0);
});

test('sanitizeSvg strips scripts, handlers, external hrefs and DOCTYPE; keeps benign content', () => {
  const dirty = `<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">
  <script>alert(2)</script>
  <foreignObject><div>hi</div></foreignObject>
  <a xlink:href="javascript:alert(3)"><rect id="r" width="10" height="10" onclick="x()"/></a>
  <image href="https://evil.example/track.png"/>
  <use href="#r"/>
  <style>@import url(http://evil.example/x.css); .a { background: url(http://evil.example/y.png); fill: red }</style>
  <circle r="5" fill="blue"/>
</svg>`;
  const result = rf.sanitizeSvg(dirty);
  assert.ok(result.ok);
  assert.ok(result.removed > 0);
  const out = result.text.toLowerCase();
  for (const bad of ['<script', 'foreignobject', 'onload', 'onclick', 'javascript:', 'evil.example', 'doctype', 'entity', '/etc/passwd']) {
    assert.ok(!out.includes(bad), `output still contains ${bad}`);
  }
  assert.ok(out.includes('<circle'), 'benign shapes survive');
  assert.ok(out.includes('href="#r"'), 'fragment hrefs survive');
});

test('sanitizeSvg refuses non-SVG and multi-root input', () => {
  assert.strictEqual(rf.sanitizeSvg('<html><body/></html>').ok, false);
  assert.strictEqual(rf.sanitizeSvg('just text').ok, false);
  assert.strictEqual(rf.sanitizeSvg('<svg/><svg/>').ok, false);
});

function makeZip(zipPath, entries) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    const zip = archiver('zip');
    out.on('close', resolve);
    zip.on('error', reject);
    zip.pipe(out);
    for (const [name, content] of entries) zip.append(content, { name });
    zip.finalize();
  });
}

test('planRevelContents omits prohibited, hidden and temp files and sanitizes SVG', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, '_media'));
  fs.mkdirSync(path.join(dir, '.thumbs'));
  fs.writeFileSync(path.join(dir, 'presentation.md'), '# Hi');
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
  fs.writeFileSync(path.join(dir, '__builder_temp.md'), 'tmp');
  fs.writeFileSync(path.join(dir, '.thumbs', 'a.png'), 'x');
  fs.writeFileSync(path.join(dir, 'evil.js'), 'alert(1)');
  fs.writeFileSync(path.join(dir, '_media', 'fake.png'), Buffer.from('MZ\x90\x00rest'));
  fs.writeFileSync(path.join(dir, '_media', 'ok.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(dir, '_media', 'bad.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
  const plan = rf.planRevelContents(dir);
  fs.rmSync(dir, { recursive: true, force: true });

  assert.deepStrictEqual(plan.entries.map((e) => e.name), ['_media/bad.svg', '_media/ok.png', 'presentation.md']);
  assert.deepStrictEqual(plan.cleaned, ['_media/bad.svg']);
  assert.ok(!plan.entries.find((e) => e.name.endsWith('.svg')).buffer.toString().includes('<script'));
  const reasons = Object.fromEntries(plan.omitted.map((o) => [o.name, o.reason]));
  assert.ok(reasons['evil.js']);
  assert.match(reasons['_media/fake.png'], /executable/);
});

test('extractRevelArchive skips unsafe, prohibited and hidden entries, and keeps good ones', async () => {
  const dir = tmpDir();
  const zip = path.join(dir, 'in.revel');
  fs.writeFileSync(zip, rawZip([
    ['presentation.md', '# ok'],
    ['_media/pic.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ['../escape.md', 'nope'],
    ['sub/../../escape2.md', 'nope'],
    ['run.sh', 'echo hi'],
    ['_media/disguised.png', Buffer.from('MZ\x90\x00')],
    ['.hidden/state.json', '{}'],
    ['vector.svg', '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><circle r="1"/></svg>']
  ]));
  const dest = path.join(dir, 'out');
  const result = await rf.extractRevelArchive(zip, dest);
  const skipped = Object.fromEntries(result.skipped.map((s) => [s.name, s.reason]));

  assert.deepStrictEqual([...result.names].sort(), ['_media/pic.png', 'presentation.md', 'vector.svg']);
  assert.ok(skipped['../escape.md'] && skipped['sub/../../escape2.md']);
  assert.ok(skipped['run.sh']);
  assert.match(skipped['_media/disguised.png'], /executable/);
  assert.ok(!fs.existsSync(path.join(dir, 'escape.md')) && !fs.existsSync(path.join(dir, 'escape2.md')));
  assert.ok(!fs.existsSync(path.join(dest, '_media', 'disguised.png')), 'skipped file is removed from disk');
  assert.ok(!fs.existsSync(path.join(dest, '.hidden')));
  assert.deepStrictEqual(result.cleaned, ['vector.svg']);
  assert.ok(!fs.readFileSync(path.join(dest, 'vector.svg'), 'utf8').includes('onload'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('extractRevelArchive enforces entry-count and size limits', async () => {
  const dir = tmpDir();
  const zip = path.join(dir, 'in.revel');
  await makeZip(zip, [['a.md', 'aaaa'], ['b.md', 'bbbb'], ['c.md', 'cccc']]);
  await assert.rejects(rf.extractRevelArchive(zip, path.join(dir, 'o1'), { maxEntries: 2 }), /too many entries/);
  await assert.rejects(rf.extractRevelArchive(zip, path.join(dir, 'o2'), { maxTotalBytes: 5 }), /too large/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pack then extract round-trips a presentation folder', async () => {
  const { writePresentationManifest } = require('../lib/presentationManifest');
  const src = tmpDir();
  fs.mkdirSync(path.join(src, '_media'));
  fs.writeFileSync(path.join(src, 'presentation.md'), '---\ntitle: T\n---\n# Slide');
  fs.writeFileSync(path.join(src, '_media', 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  await writePresentationManifest(src, { title: 'T' });
  const plan = rf.planRevelContents(src);
  const out = path.join(tmpDir(), 'x.revel');
  await rf.writeRevelArchive(plan, path.join(src, 'manifest.json'), out);

  const dest = tmpDir();
  const result = await rf.extractRevelArchive(out, dest);
  assert.deepStrictEqual(result.skipped, []);
  assert.deepStrictEqual([...result.names].sort(), ['_media/pic.png', 'manifest.json', 'presentation.md']);
  assert.ok(fs.readFileSync(path.join(src, '_media', 'pic.png')).equals(fs.readFileSync(path.join(dest, '_media', 'pic.png'))));
  for (const d of [src, dest, path.dirname(out)]) fs.rmSync(d, { recursive: true, force: true });
});
