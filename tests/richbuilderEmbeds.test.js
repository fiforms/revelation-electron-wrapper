// plugins/richbuilder/builder-markdown.js: YouTube / web embed lines and macro card labels.
// Embeds must render as cards (not <img>) in the rich editor and keep their exact markdown.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'plugins', 'richbuilder', 'builder-markdown.js')).href);

test('parseEmbedLine recognises youtube, youtube:fit and web lines only', async () => {
  const { parseEmbedLine } = await load();
  assert.deepStrictEqual(parseEmbedLine('![youtube](https://youtu.be/abcDEF12345)'), { kind: 'youtube', modifier: '', url: 'https://youtu.be/abcDEF12345' });
  assert.deepStrictEqual(parseEmbedLine('![youtube:fit](https://youtu.be/abcDEF12345)'), { kind: 'youtube', modifier: 'fit', url: 'https://youtu.be/abcDEF12345' });
  assert.deepStrictEqual(parseEmbedLine('![web:scrolly=240](https://example.com)'), { kind: 'web', modifier: 'scrolly=240', url: 'https://example.com' });
  assert.strictEqual(parseEmbedLine('![background](media:tag)'), null);
  assert.strictEqual(parseEmbedLine('![alt](pic.png)'), null);
});

test('isValidEmbedUrl accepts the compiler\'s YouTube forms and rejects placeholders', async () => {
  const { isValidEmbedUrl } = await load();
  assert.ok(isValidEmbedUrl('youtube', 'https://youtu.be/abcDEF12345'));
  assert.ok(isValidEmbedUrl('youtube', 'https://www.youtube.com/watch?v=abcDEF12345'));
  assert.ok(isValidEmbedUrl('youtube', 'https://www.youtube.com/embed/abcDEF12345'));
  assert.ok(!isValidEmbedUrl('youtube', 'PASTE LINK'));
  assert.ok(!isValidEmbedUrl('youtube', 'https://example.com/video'));
  assert.ok(isValidEmbedUrl('web', 'https://example.com/a?b=1'));
  assert.ok(!isValidEmbedUrl('web', 'example.com'));
});

test('macroCardLabel describes embeds and audio macros', async () => {
  const { macroCardLabel } = await load();
  assert.strictEqual(macroCardLabel('![youtube](https://youtu.be/abcDEF12345)'), '▶ YouTube — youtu.be/abcDEF12345');
  assert.match(macroCardLabel('![youtube:fit](https://youtu.be/abcDEF12345)'), /^▶ YouTube \(fit\) — /);
  assert.match(macroCardLabel('![web](https://example.com)'), /^🌐 Web embed — example\.com/);
  assert.strictEqual(macroCardLabel(':audio:play:media:song:'), '♪ Play: song');
  assert.strictEqual(macroCardLabel(':audio:playloop:media:song:'), '♪ Loop: song');
  assert.strictEqual(macroCardLabel(':audio:stop:'), '■ Stop audio');
  assert.strictEqual(macroCardLabel(':lt:'), ':lt:');
});

test('markdownToHtml turns an embed line into a macro card that keeps the raw line', async () => {
  const { markdownToHtml } = await load();
  const line = '![youtube](https://youtu.be/abcDEF12345)';
  const html = markdownToHtml(line);
  assert.match(html, /richbuilder-embed-token/);
  assert.match(html, /richbuilder-macro-token/);
  assert.ok(!/<img/.test(html));
  assert.ok(html.includes(encodeURIComponent(line)));
});
