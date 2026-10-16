// The modules split out of main.js load cleanly (against the Electron stub, no GUI), and the per-release
// downloadable-plugin catalog in lib/downloadablePlugins.json is well-formed so a typo in a hash is caught before release.
const test = require('node:test');
const assert = require('node:assert');
const { installElectronStub } = require('./helpers/electron-stub');

installElectronStub();

test('modules split out of main.js load and export what main.js uses', () => {
  const expected = {
    appContext: ['createAppContext', 'applyZoomFactorToWindow', 'normalizeZoomFactor'],
    appResources: ['ensureWritableResources', 'ensureAppNodeModulesOnPath', 'installPluginLibRedirect', 'resolvePluginLibRequest'],
    startupGuards: ['isDebugEnabled', 'silenceOutputUnlessDebug', 'installNetworkErrorGuard', 'trustPrivateNetworkCertificates'],
    mainWindow: ['createMainWindow', 'applyApplicationMenu', 'scheduleAlwaysOpenScreens', 'cancelAlwaysOpenScreens'],
    firstRunWizard: ['register', 'maybeShowPrompt', 'consumeOpenPluginSettingsRequest'],
    downloadablePluginInstaller: ['register', 'isPayloadInstalled'],
    linuxFileIcon: ['scheduleLinuxFileIcon'],
    docsPresentationBuilder: ['ensureDocumentationPresentation']
  };
  for (const [name, fns] of Object.entries(expected)) {
    const mod = require(`../lib/${name}`);
    for (const fn of fns) assert.strictEqual(typeof mod[fn], 'function', `${name}.${fn}`);
  }
});

test('createAppContext: translate falls back to the English string; normalizeZoomFactor clamps', () => {
  const { createAppContext, normalizeZoomFactor } = require('../lib/appContext');
  const ctx = createAppContext({ debugEnabled: false, runtimeDevToolsEnabled: false });
  ctx.config = { language: 'es' };
  ctx.translations = { es: { Retry: 'Reintentar' } };
  assert.strictEqual(ctx.translate('Retry'), 'Reintentar');
  assert.strictEqual(ctx.translate('Unknown'), 'Unknown');
  assert.strictEqual(normalizeZoomFactor('9'), 3);
  assert.strictEqual(normalizeZoomFactor('0.1'), 0.5);
  assert.strictEqual(normalizeZoomFactor('abc', 1), 1);
});

test('downloadablePlugins: every platform entry has a pinned file under a release tag and a 64-hex SHA-256', () => {
  const { listDownloadablePlugins, findDownloadablePlugin, getDownload } = require('../lib/downloadablePlugins');
  const entries = listDownloadablePlugins();
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.match(entry.id, /^[a-z0-9][a-z0-9_-]*$/);
    assert.ok(entry.slot, `${entry.id} slot`);
    assert.match(entry.release, /^https:\/\/github\.com\/.+\/releases\/download\/v[\d.]+$/);
    for (const [key, download] of Object.entries(entry.downloads)) {
      assert.match(download.file, /^[^/\\]+\.zip$/, `${entry.id} ${key} file`);
      assert.match(download.sha256, /^[0-9a-f]{64}$/, `${entry.id} ${key} sha256`);
    }
    for (const target of Object.values(entry.aliases || {})) assert.ok(entry.downloads[target], `${entry.id} alias target`);
  }
  const entry = entries[0];
  assert.strictEqual(findDownloadablePlugin(entry.id), entry);
  assert.strictEqual(findDownloadablePlugin('nope'), null);
  assert.strictEqual(getDownload(entry, 'linux', 'x64'), null);
  assert.deepStrictEqual(getDownload(entry, 'win32', 'arm64'), getDownload(entry, 'win32', 'x64'));
  const mac = getDownload(entry, 'darwin', 'arm64');
  assert.strictEqual(mac.url, `${entry.release}/${entry.downloads['darwin-arm64'].file}`);
});
