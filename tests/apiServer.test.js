// The local control API (lib/apiServer.js + presentationControlRoutes.js) over real loopback HTTP.
// No window is ever opened: every request here is rejected or answered before a BrowserWindow
// would be needed, so this checks auth, routing, formats and input validation.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { installElectronStub } = require('./helpers/electron-stub');
const { tmpDir } = require('./helpers/paths');

installElectronStub();
const { apiServer } = require('../lib/apiServer');

const KEY = 'test-key-1234';
let presentationsDir;
let base;

const ctx = () => ({
  config: { apiServerEnabled: true, apiServerPort: 18900, viteServerPort: 18899, key: KEY, presentationsDir },
  plugins: {},
  log() {}, error() {}
});

async function call(method, pathAndQuery, { body, headers = {}, key = KEY } = {}) {
  const url = `${base}${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}format=json${key ? `&key=${key}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  // Auth/routing errors (401/404/405) are always sent as YAML, whatever ?format says, so only
  // parse the body when it is JSON.
  const text = await res.text();
  return { status: res.status, text, json: res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null };
}

test.before(async () => {
  presentationsDir = tmpDir();
  fs.mkdirSync(path.join(presentationsDir, 'demo'));
  fs.writeFileSync(path.join(presentationsDir, 'demo', 'presentation.md'), '# demo');
  const context = ctx();
  await apiServer.start(context);
  assert.ok(apiServer._server, 'server started');
  await new Promise((resolve) => (apiServer._server.listening ? resolve() : apiServer._server.once('listening', resolve)));
  base = `http://127.0.0.1:${context.config.apiServerPort}`;
});

test.after(() => {
  apiServer.stop();
  fs.rmSync(presentationsDir, { recursive: true, force: true });
});

test('binds to loopback only', () => {
  assert.strictEqual(apiServer._server.address().address, '127.0.0.1');
});

test('rejects missing or wrong key; accepts x-api-key header', async () => {
  assert.strictEqual((await call('GET', '/api/presentation/status', { key: '' })).status, 401);
  assert.strictEqual((await call('GET', '/api/presentation/status', { key: 'nope' })).status, 401);
  const viaHeader = await call('GET', '/api/presentation/status', { key: '', headers: { 'x-api-key': KEY } });
  assert.strictEqual(viaHeader.status, 200);
});

test('only GET and POST; unknown routes 404', async () => {
  assert.strictEqual((await call('DELETE', '/api/presentation/status')).status, 405);
  assert.strictEqual((await call('PUT', '/api/presentation/status')).status, 405);
  assert.strictEqual((await call('GET', '/api/nope')).status, 404);
  assert.strictEqual((await call('GET', '/api/presentation/control')).status, 404, 'POST-only route is not reachable by GET');
});

test('status reports no open presentation', async () => {
  const r = await call('GET', '/api/presentation/status');
  assert.deepStrictEqual(r.json, { success: true, data: { isOpen: false } });
});

test('default response format is YAML, ?format=json gives JSON', async () => {
  const res = await fetch(`${base}/api/presentation/status?key=${KEY}`);
  assert.match(res.headers.get('content-type'), /yaml/);
  assert.match(await res.text(), /success: true/);
});

test('control: unknown action 400, valid action without a window 409', async () => {
  assert.strictEqual((await call('POST', '/api/presentation/control', { body: { action: 'explode' } })).status, 400);
  assert.strictEqual((await call('POST', '/api/presentation/control', { body: { action: 'next' } })).status, 409);
});

test('open: validates slug/mdFile and refuses path traversal before touching any window', async () => {
  const open = (body) => call('POST', '/api/presentation/open', { body });
  assert.strictEqual((await open({})).status, 400);
  assert.strictEqual((await open({ slug: 'demo' })).status, 400);
  assert.strictEqual((await open({ slug: '../etc', mdFile: 'x.md' })).status, 400);
  assert.strictEqual((await open({ slug: 'a/b', mdFile: 'x.md' })).status, 400);
  assert.strictEqual((await open({ slug: 'demo', mdFile: '../../secret.md' })).status, 400);
  assert.strictEqual((await open({ slug: 'missing', mdFile: 'presentation.md' })).status, 404);
  assert.strictEqual((await open({ slug: 'demo', mdFile: 'absent.md' })).status, 404);
});
