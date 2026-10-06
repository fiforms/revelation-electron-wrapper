// plugins/widgets/client.js: how the browser half reaches the main process (hostFetch -> findBridge).
// The Electron preload exposes electronAPI on the top frame only, so inside picture-in-picture (the deck is
// an iframe in pip.html) and in the builder preview the bridge has to be found on the parent window.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const { ROOT } = require('./helpers/paths');

let createElectronApiLocator;
test.before(async () => {
  ({ createElectronApiLocator } = await import(pathToFileURL(path.join(ROOT, 'revelation', 'js', 'electron-api.js')).href));
});

const SOURCE = fs.readFileSync(path.join(ROOT, 'plugins', 'widgets', 'client.js'), 'utf8');

// Runs the real client.js in a context whose `window` is `win` and returns the registered plugin.
function load(win) {
  win.self = win.self || win;
  win.RevelationElectronAPI = createElectronApiLocator(win);
  const sandbox = { window: win, document: { documentElement: { lang: 'en' } }, navigator: { language: 'en' }, console };
  vm.runInNewContext(SOURCE, sandbox);
  return win.RevelationPlugins.widgets;
}

const calls = [];
const api = (name) => ({
  [name]: async (plugin, invoke, req) => { calls.push({ via: name, plugin, invoke, req }); return { ok: true, data: 'x' }; }
});
const call = (plugin) => plugin.hostFetch('calendar', { a: 1 }, 'ics', { b: 2 });
const reqOf = { widget: 'calendar', endpoint: 'ics', params: { a: 1 }, args: { b: 2 } };
const plain = (v) => JSON.parse(JSON.stringify(v)); // the vm context has its own Object prototype

test.beforeEach(() => { calls.length = 0; });

test('a presentation window uses its own presentationPluginTrigger', async () => {
  const win = { electronAPI: api('presentationPluginTrigger') };
  win.parent = win;
  await call(load(win));
  assert.deepStrictEqual(plain(calls), [{ via: 'presentationPluginTrigger', plugin: 'widgets', invoke: 'fetch', req: reqOf }]);
});

test('picture-in-picture: the deck is an iframe, so the bridge is found on the parent (pip.html)', async () => {
  const pip = { electronAPI: api('presentationPluginTrigger') };
  const deck = { parent: pip }; // no electronAPI of its own
  const result = await call(load(deck));
  assert.deepStrictEqual(plain(calls), [{ via: 'presentationPluginTrigger', plugin: 'widgets', invoke: 'fetch', req: reqOf }]);
  assert.strictEqual(result.ok, true);
});

test('builder preview: the parent is the admin window, which exposes pluginTrigger', async () => {
  const admin = { electronAPI: api('pluginTrigger') };
  await call(load({ parent: admin }));
  assert.deepStrictEqual(plain(calls), [{ via: 'pluginTrigger', plugin: 'widgets', invoke: 'fetch', req: reqOf }]);
});

test('the window\'s own bridge wins over the parent\'s', async () => {
  const win = { electronAPI: api('presentationPluginTrigger'), parent: { electronAPI: api('pluginTrigger') } };
  await call(load(win));
  assert.deepStrictEqual(calls.map((c) => c.via), ['presentationPluginTrigger']);
});

test('with no bridge anywhere the widget gets the upstream_unreachable error', async () => {
  const deck = { parent: {} };
  await assert.rejects(call(load(deck)), (err) => err.reason === 'upstream_unreachable');
  const top = {};
  top.parent = top;
  await assert.rejects(call(load(top)), (err) => err.reason === 'upstream_unreachable');
});

test('a cross-origin parent (an external page in PiP) cannot be read and is not an error source', async () => {
  const hostile = {
    get parent() {
      return { get electronAPI() { throw new Error('Blocked a frame from accessing a cross-origin frame.'); } };
    }
  };
  await assert.rejects(call(load(hostile)), (err) => err.reason === 'upstream_unreachable');
});

test('errors reported by the main process surface with their reason', async () => {
  const pip = { electronAPI: { presentationPluginTrigger: async () => ({ error: { reason: 'blocked_host', status: 403 } }) } };
  await assert.rejects(call(load({ parent: pip })), (err) => err.reason === 'blocked_host' && err.status === 403);
});

// api.mode: widgets use 'editor' to show placement hints, so a live screen must report 'live'.
function framed(parent) {
  const top = { name: 'top' };
  const win = { parent, top: parent.top || top, self: undefined };
  win.self = win;
  return win;
}

test('api.mode is live for a top-level window and for the picture-in-picture deck, editor for the builder preview', () => {
  const top = {};
  top.parent = top; top.top = top; top.self = top;
  assert.strictEqual(load(top).hostMode(), 'live');

  const pip = { electronAPI: api('presentationPluginTrigger') };
  pip.top = pip;
  assert.strictEqual(load(framed(pip)).hostMode(), 'live', 'PiP is a live screen even though the deck is an iframe');

  const admin = { electronAPI: api('pluginTrigger') };
  admin.top = admin;
  assert.strictEqual(load(framed(admin)).hostMode(), 'editor', 'builder preview');

  const plain = {};
  plain.top = plain;
  assert.strictEqual(load(framed(plain)).hostMode(), 'editor', 'any other iframe keeps the old behaviour');
});

test('a cross-origin parent still counts as an editor preview (it is not the PiP shell)', () => {
  const hostile = {
    get parent() { return { get electronAPI() { throw new Error('cross-origin'); } }; },
    top: {}
  };
  hostile.self = hostile;
  assert.strictEqual(load(hostile).hostMode(), 'editor');
});
