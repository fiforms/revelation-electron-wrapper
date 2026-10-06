// Smoke test: every main-process module and plugin entry file can be require()d (against the
// Electron stub) without throwing. Catches missing requires, bad exports and load-time typos
// that `node --check` cannot see.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { installElectronStub } = require('./helpers/electron-stub');
const { ROOT } = require('./helpers/paths');

installElectronStub();

const libFiles = fs.readdirSync(path.join(ROOT, 'lib')).filter((f) => f.endsWith('.js'));
for (const file of libFiles) {
  test(`lib/${file} loads`, () => {
    assert.doesNotThrow(() => require(path.join(ROOT, 'lib', file)));
  });
}

const pluginDirs = fs.readdirSync(path.join(ROOT, 'plugins'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(ROOT, 'plugins', e.name, 'plugin.js')))
  .map((e) => e.name);
for (const name of pluginDirs) {
  test(`plugins/${name}/plugin.js loads and exports an object`, () => {
    const plugin = require(path.join(ROOT, 'plugins', name, 'plugin.js'));
    assert.ok(plugin && typeof plugin === 'object', 'plugin must export an object');
  });
}
