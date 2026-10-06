// The modules split out of main.js load cleanly (against the Electron stub, no GUI), and the per-release
// Poppler download table in lib/popplerRelease.js is well-formed so a typo in a hash is caught before release.
const test = require('node:test');
const assert = require('node:assert');
const { installElectronStub } = require('./helpers/electron-stub');

installElectronStub();

test('modules split out of main.js load and export what main.js uses', () => {
  const expected = {
    appContext: ['createAppContext', 'applyZoomFactorToWindow', 'normalizeZoomFactor'],
    appResources: ['ensureWritableResources', 'ensureAppNodeModulesOnPath'],
    startupGuards: ['isDebugEnabled', 'silenceOutputUnlessDebug', 'installNetworkErrorGuard', 'trustPrivateNetworkCertificates'],
    mainWindow: ['createMainWindow', 'applyApplicationMenu', 'scheduleAlwaysOpenScreens', 'cancelAlwaysOpenScreens'],
    firstRunWizard: ['register', 'maybeShowPrompt', 'consumeOpenPluginSettingsRequest'],
    popplerInstaller: ['register', 'isPayloadInstalled'],
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

test('popplerRelease: every platform entry has a pinned URL and a 64-hex SHA-256', () => {
  const { POPPLER_PLUGIN_RELEASE, POPPLER_PLUGIN_DOWNLOADS, getPopplerPluginDownload } = require('../lib/popplerRelease');
  assert.match(POPPLER_PLUGIN_RELEASE, /^https:\/\/github\.com\/.+\/releases\/download\/v[\d.]+$/);
  for (const [key, entry] of Object.entries(POPPLER_PLUGIN_DOWNLOADS)) {
    assert.match(entry.url, /^https:\/\/.+\.zip$/, `${key} url`);
    assert.ok(entry.url.startsWith(POPPLER_PLUGIN_RELEASE), `${key} url is under the release tag`);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, `${key} sha256`);
  }
  assert.strictEqual(POPPLER_PLUGIN_DOWNLOADS['win32-arm64'], POPPLER_PLUGIN_DOWNLOADS['win32-x64']);
  assert.strictEqual(getPopplerPluginDownload('linux', 'x64'), null);
  assert.strictEqual(getPopplerPluginDownload('darwin', 'arm64'), POPPLER_PLUGIN_DOWNLOADS['darwin-arm64']);
});
