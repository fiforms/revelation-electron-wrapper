// plugins/bibletext online lookups: status checks, non-JSON bodies, "none", the ESV key, and escaping of
// third-party text in the generated markdown. Uses a loopback server, so no network is needed.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { installElectronStub } = require('./helpers/electron-stub');

installElectronStub();

const { fetchJson } = require('../lib/httpUtil');
const plugin = require('../plugins/bibletext/plugin.js');

let server;
let base;
let lastHeaders;

test.before(async () => {
  server = http.createServer((req, res) => {
    lastHeaders = req.headers;
    if (req.url.startsWith('/data')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ translations: [{ identifier: 'web', name: 'World English Bible', language: 'English' }] }));
    }
    if (req.url.startsWith('/html')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html><body>Service unavailable</body></html>');
    }
    if (req.url.startsWith('/missing')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'not found' }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      reference: 'John 3:16', translation_name: 'World <b>English</b>', translation_id: 'web',
      verses: [{ book_name: 'John', chapter: 3, verse: 16, text: 'For God <img src=x onerror=alert(1)> so loved' }]
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('fetchJson: parses JSON, sends headers, and explains a non-JSON body and a bad status', async () => {
  assert.deepStrictEqual((await fetchJson(`${base}/data`, { headers: { Authorization: 'Token abc' } })).translations.length, 1);
  assert.strictEqual(lastHeaders.authorization, 'Token abc');
  await assert.rejects(fetchJson(`${base}/html`), (err) => err.code === 'bad-json' && /did not return JSON/.test(err.message));
  await assert.rejects(fetchJson(`${base}/missing`), (err) => err.code === 'http-status');
});

test('getPassageData: bibleAPI "none" and an empty ESV key give clear errors', async () => {
  const ctx = { log() {}, error() {}, config: { pluginFolder: '/nonexistent' }, plugins: { bibletext: { config: {}, getCfg: () => ({ bibleAPI: 'none', esvApiKey: '' }) } } };
  plugin.register(ctx);
  await assert.rejects(plugin.getPassageData('John.3.16', 'kjv'), /turned off/);
  await assert.rejects(plugin.getPassageData('John.3.16', 'esv'), /API key/);
});

test('online text is angle-escaped in markdown; an http bibleAPI is fetched', async () => {
  const ctx = { log() {}, error() {}, config: { pluginFolder: '/nonexistent' }, plugins: { bibletext: { config: {}, getCfg: () => ({ bibleAPI: base, esvApiKey: '' }) } } };
  plugin.register(ctx);
  const res = await plugin.getPassageData('John.3.16', 'web');
  assert.strictEqual(res.data.verses.length, 1);
  const md = await plugin.api['fetch-passage']({}, { osis: 'John.3.16', translation: 'web' });
  assert.ok(md.success, JSON.stringify(md));
  assert.ok(!/<img|<b>/.test(md.markdown), md.markdown);
  assert.match(md.markdown, /&lt;img/);
});
