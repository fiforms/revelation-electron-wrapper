// lib/httpUtil.js against a real loopback HTTP server: streaming, size caps, timeouts, redirects, cleanup.
// Caps are passed in small here; the production defaults (8 GiB per file) are asserted by value only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { downloadToFile, fetchBuffer, DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_BUFFER_BYTES } = require('../lib/httpUtil');
const { tmpDir } = require('./helpers/paths');

let server;
let base;
const payload = crypto.randomBytes(256 * 1024);

test.before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    switch (url.pathname) {
      case '/ok':
        res.writeHead(200, { 'content-length': payload.length });
        return res.end(payload);
      case '/declared-big': // declares far more than the cap, sends little
        res.writeHead(200, { 'content-length': 50 * 1024 * 1024 });
        return res.end('x');
      case '/endless': { // chunked, never ends
        res.writeHead(200);
        const timer = setInterval(() => res.write(Buffer.alloc(16 * 1024, 1)), 1);
        res.on('close', () => clearInterval(timer));
        return undefined;
      }
      case '/truncated':
        res.writeHead(200, { 'content-length': 1000 });
        res.write('only a little');
        return setTimeout(() => res.destroy(), 20);
      case '/stall':
        res.writeHead(200);
        res.write('start');
        return undefined; // then silence
      case '/redirect':
        res.writeHead(302, { location: '/ok' });
        return res.end();
      case '/loop':
        res.writeHead(302, { location: '/loop' });
        return res.end();
      case '/missing':
        res.writeHead(404);
        return res.end('nope');
      case '/exe':
        res.writeHead(200, { 'content-length': 4 });
        return res.end(Buffer.from([0x4d, 0x5a, 0x90, 0x00]));
      default:
        res.writeHead(500);
        return res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.closeAllConnections?.();
  server.close();
});

const dest = (dir, name = 'out.bin') => path.join(dir, name);

test('defaults: 8 GiB per file (multi-GB media must pass), 32 MiB for in-memory reads', () => {
  assert.strictEqual(DEFAULT_MAX_FILE_BYTES, 8 * 1024 * 1024 * 1024);
  assert.ok(DEFAULT_MAX_FILE_BYTES > 3 * 1024 * 1024 * 1024);
  assert.strictEqual(DEFAULT_MAX_BUFFER_BYTES, 32 * 1024 * 1024);
});

test('downloadToFile streams to disk and reports size, sha1 and the first bytes', async () => {
  const dir = tmpDir();
  const result = await downloadToFile(`${base}/ok`, dest(dir));
  assert.strictEqual(result.size, payload.length);
  assert.strictEqual(result.sha1, crypto.createHash('sha1').update(payload).digest('hex'));
  assert.deepStrictEqual(result.head, payload.subarray(0, 8));
  assert.ok(fs.readFileSync(dest(dir)).equals(payload));
});

test('the destination can be chosen from the response', async () => {
  const dir = tmpDir();
  const result = await downloadToFile(`${base}/exe`, (res) => dest(dir, `len-${res.headers['content-length']}.bin`));
  assert.strictEqual(path.basename(result.path), 'len-4.bin');
  assert.deepStrictEqual(result.head, Buffer.from([0x4d, 0x5a, 0x90, 0x00]));
});

test('a declared Content-Length over the cap is refused before any body is written', async () => {
  const dir = tmpDir();
  await assert.rejects(downloadToFile(`${base}/declared-big`, dest(dir), { maxBytes: 1024 * 1024 }), (err) => err.code === 'too-large');
  assert.strictEqual(fs.existsSync(dest(dir)), false);
});

test('a body that grows past the cap is aborted and the partial file removed', async () => {
  const dir = tmpDir();
  await assert.rejects(downloadToFile(`${base}/endless`, dest(dir), { maxBytes: 512 * 1024 }), (err) => err.code === 'too-large');
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('a download that exactly fits the cap succeeds', async () => {
  const dir = tmpDir();
  const result = await downloadToFile(`${base}/ok`, dest(dir), { maxBytes: payload.length });
  assert.strictEqual(result.size, payload.length);
});

test('a connection that closes early fails and leaves no partial file', async () => {
  const dir = tmpDir();
  await assert.rejects(downloadToFile(`${base}/truncated`, dest(dir)), Error);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('a stalled body hits the idle timeout (not a total timeout) and is cleaned up', async () => {
  const dir = tmpDir();
  await assert.rejects(downloadToFile(`${base}/stall`, dest(dir), { idleTimeoutMs: 150 }), (err) => err.code === 'timeout');
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('redirects are followed, loops are stopped', async () => {
  const dir = tmpDir();
  const result = await downloadToFile(`${base}/redirect`, dest(dir));
  assert.strictEqual(result.size, payload.length);
  await assert.rejects(downloadToFile(`${base}/loop`, dest(dir, 'loop.bin')), (err) => err.code === 'redirects');
});

test('non-200 statuses, non-http URLs and httpsOnly are rejected', async () => {
  const dir = tmpDir();
  await assert.rejects(downloadToFile(`${base}/missing`, dest(dir)), (err) => err.code === 'http-status');
  await assert.rejects(downloadToFile('file:///etc/passwd', dest(dir)), (err) => err.code === 'protocol');
  await assert.rejects(downloadToFile('not a url', dest(dir)), (err) => err.code === 'bad-url');
  await assert.rejects(downloadToFile(`${base}/ok`, dest(dir), { httpsOnly: true }), (err) => err.code === 'protocol');
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('an existing destination is never overwritten or deleted', async () => {
  const dir = tmpDir();
  fs.writeFileSync(dest(dir), 'precious');
  await assert.rejects(downloadToFile(`${base}/ok`, dest(dir)), (err) => err.code === 'EEXIST');
  assert.strictEqual(fs.readFileSync(dest(dir), 'utf8'), 'precious');
});

test('a symlink at the destination is not written through', async () => {
  const dir = tmpDir();
  const target = path.join(dir, 'victim.txt');
  fs.writeFileSync(target, 'untouched');
  try {
    fs.symlinkSync(target, dest(dir, 'link.bin'));
  } catch {
    return; // symlinks unavailable (e.g. unprivileged Windows)
  }
  await assert.rejects(downloadToFile(`${base}/ok`, dest(dir, 'link.bin')));
  assert.strictEqual(fs.readFileSync(target, 'utf8'), 'untouched');
});

test('fetchBuffer reads small bodies and enforces its own cap', async () => {
  const buffer = await fetchBuffer(`${base}/ok`);
  assert.ok(buffer.equals(payload));
  await assert.rejects(fetchBuffer(`${base}/ok`, { maxBytes: 1000 }), (err) => err.code === 'too-large');
  await assert.rejects(fetchBuffer(`${base}/endless`, { maxBytes: 100 * 1024 }), (err) => err.code === 'too-large');
  await assert.rejects(fetchBuffer(`${base}/missing`), (err) => err.code === 'http-status');
});
