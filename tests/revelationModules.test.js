// lib/revelationModules.js: how the wrapper finds code shared from the revelation submodule, in a
// checkout and in a packaged app (where lib/ is inside app.asar and revelation/ is in resources/).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { resolveRevelationServerModule, requireRevelationServerModule } = require('../lib/revelationModules');
const { ROOT, tmpDir } = require('./helpers/paths');

test('in a checkout it resolves beside lib/', () => {
  const resolved = resolveRevelationServerModule('peer-protocol');
  assert.strictEqual(resolved, path.join(ROOT, 'lib', '..', 'revelation', 'server', 'peer-protocol.js'));
  assert.ok(fs.existsSync(resolved));
  assert.strictEqual(typeof requireRevelationServerModule('peer-protocol').signChallenge, 'function');
});

test('packaged layout: lib/ inside app.asar has no revelation/, so resources/revelation is used', () => {
  const resources = tmpDir();
  const bundled = path.join(resources, 'revelation', 'server', 'peer-protocol.js');
  fs.mkdirSync(path.dirname(bundled), { recursive: true });
  fs.writeFileSync(bundled, 'module.exports = { from: "resources" };');
  const asarLib = path.join(resources, 'app.asar', 'lib'); // does not exist on disk, like a real asar path here
  assert.strictEqual(resolveRevelationServerModule('peer-protocol', { libDir: asarLib, resourcesPath: resources }), bundled);
  assert.deepStrictEqual(requireRevelationServerModule('peer-protocol', { libDir: asarLib, resourcesPath: resources }), { from: 'resources' });
  fs.rmSync(resources, { recursive: true, force: true });
});

test('a sibling revelation/ wins over resources (dev beats a stale bundle)', () => {
  const seen = [];
  const exists = (p) => { seen.push(p); return true; };
  const resolved = resolveRevelationServerModule('peer-protocol', { libDir: '/app/lib', resourcesPath: '/res', exists });
  assert.strictEqual(resolved, path.join('/app/lib', '..', 'revelation', 'server', 'peer-protocol.js'));
  assert.strictEqual(seen.length, 1);
});

test('the userData mirror is never consulted (it can be stale at startup)', () => {
  const seen = [];
  assert.throws(() => resolveRevelationServerModule('peer-protocol', {
    libDir: '/app/lib', resourcesPath: '/res', exists: (p) => { seen.push(p); return false; }
  }));
  assert.strictEqual(seen.length, 2);
  assert.ok(seen.every((p) => !/userData|resources[\\/]resources/i.test(p)), seen.join());
});

test('when nothing is found the error lists every place that was tried', () => {
  assert.throws(
    () => resolveRevelationServerModule('peer-protocol', { libDir: '/nowhere/lib', resourcesPath: '/nowhere/res', exists: () => false }),
    (err) => /peer-protocol\.js not found/.test(err.message) && err.message.includes(path.join('/nowhere/lib', '..', 'revelation')) && err.message.includes(path.join('/nowhere/res', 'revelation'))
  );
  assert.throws(() => resolveRevelationServerModule('peer-protocol', { libDir: '/x/lib', resourcesPath: '', exists: () => false }), /not found/, 'no resourcesPath is fine');
});

test('module names cannot escape server/', () => {
  for (const bad of ['../peer-protocol', 'a/b', '', '..', 'Peer', 'x.js', undefined, null]) {
    assert.throws(() => resolveRevelationServerModule(bad), /Invalid revelation server module name/, String(bad));
  }
});
