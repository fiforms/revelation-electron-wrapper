// resolvePluginLibRequest: packaged plugins live outside app.asar, so '../../lib/x' must be remapped into the asar's lib/.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { installElectronStub } = require('./helpers/electron-stub');

installElectronStub();
const { resolvePluginLibRequest } = require('../lib/appResources');

const roots = [path.resolve('/res/plugins'), path.resolve('/user/resources/plugins')];
const appLib = path.resolve('/res/app.asar/lib');

test('remaps ../../lib requests from plugin files', () => {
  assert.strictEqual(
    resolvePluginLibRequest('../../lib/ffmpegResolver.js', path.resolve('/res/plugins/screenstream/plugin.js'), roots, appLib),
    path.join(appLib, 'ffmpegResolver.js'));
  assert.strictEqual(
    resolvePluginLibRequest('../../../lib/frontMatter', path.resolve('/user/resources/plugins/freeshow/lib/x.js'), roots, appLib),
    path.join(appLib, 'frontMatter'));
});

test('leaves other requests alone', () => {
  const parent = path.resolve('/res/plugins/screenstream/plugin.js');
  assert.strictEqual(resolvePluginLibRequest('./fmp4', parent, roots, appLib), null);
  assert.strictEqual(resolvePluginLibRequest('electron', parent, roots, appLib), null);
  assert.strictEqual(resolvePluginLibRequest('../../lib/x', path.resolve('/elsewhere/a.js'), roots, appLib), null);
});
