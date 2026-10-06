// R5: lib/exportPresentation.js runs each plugin's offline.js build() before export(), so a missing
// bundle fails the export with a clear message instead of shipping a broken page.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { installElectronStub } = require('./helpers/electron-stub');
const { tmpDir } = require('./helpers/paths');

installElectronStub();
const { collectPluginOfflineExportData } = require('../lib/exportPresentation');

function setup(offlineSource) {
  const pluginFolder = fs.mkdtempSync(path.join(tmpDir(), 'offline-'));
  fs.mkdirSync(path.join(pluginFolder, 'demo'));
  fs.writeFileSync(path.join(pluginFolder, 'demo', 'offline.js'), offlineSource);
  return { pluginFolder, ctx: { config: { pluginFolder }, plugins: { demo: {} } } };
}

test('offline build() runs before export(); a throwing build() fails the export', async () => {
  const ok = setup(`
    let built = false;
    module.exports = {
      async build() { built = true; },
      async export() { if (!built) throw new Error('export before build'); return { headTags: ['<x>'] }; }
    };`);
  const res = await collectPluginOfflineExportData(ok.ctx, '/p', '/r', false, []);
  assert.deepStrictEqual(res.headTags, ['<x>']);

  const bad = setup(`module.exports = {
    async build() { throw new Error('bundle is missing'); },
    async export() { return {}; }
  };`);
  await assert.rejects(
    collectPluginOfflineExportData(bad.ctx, '/p', '/r', false, []),
    /\[offline-export\/demo\] build\(\) failed: bundle is missing/
  );
});
