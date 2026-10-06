// Small lib/ units: URL building, config helpers/profile names, origin marks (with injected deps).
const test = require('node:test');
const assert = require('node:assert');
const { installElectronStub } = require('./helpers/electron-stub');

installElectronStub();

test('buildServerURL picks protocol from the https flag', () => {
  const { buildServerURL } = require('../lib/serverUrl');
  assert.strictEqual(buildServerURL('localhost', 8000), 'http://localhost:8000');
  assert.strictEqual(buildServerURL('10.0.0.5', 8443, true), 'https://10.0.0.5:8443');
});

test('configManager: profile-name validation', () => {
  const { validateProfileName } = require('../lib/configManager');
  for (const ok of ['Church', 'Sunday 9am', 'a_b-c', 'x'.repeat(50)]) assert.ok(validateProfileName(ok), ok);
  for (const bad of ['', '  ', 'Default', '../evil', 'a/b', '-lead', 'x'.repeat(51), 'a.b', null, 5]) {
    assert.ok(!validateProfileName(bad), JSON.stringify(bad));
  }
});

test('configManager: access keys and pairing PINs have the documented shape', () => {
  const { generateAccessKey, generatePairingPin } = require('../lib/configManager');
  assert.match(generateAccessKey(), /^[0-9a-f]{16}$/);
  assert.notStrictEqual(generateAccessKey(), generateAccessKey());
  for (let i = 0; i < 50; i += 1) assert.match(generatePairingPin(), /^[1-9]\d{5}$/);
});

test('configManager: loadConfig creates a repaired config and persists it under userData', () => {
  const fs = require('fs');
  const cm = require('../lib/configManager');
  const config = cm.loadConfig();
  assert.match(config.key, /^[0-9a-f]{16}$/);
  assert.notStrictEqual(config.viteServerPort, config.apiServerPort);
  assert.ok(typeof config.presentationsDir === 'string' && config.presentationsDir.length > 0);
  assert.ok(fs.existsSync(cm.configPath), 'config.json was written');
  assert.ok(cm.configPath.startsWith(require('./helpers/electron-stub').userData), 'never touches the real user profile');
});

test('originMark: only files the app does not parse get marked, and only on the matching platform', async () => {
  const om = require('../lib/originMark');
  const calls = [];
  const deps = (platform) => ({
    platform,
    readFile: async (file) => { calls.push(['read', file]); return Buffer.from('[ZoneTransfer]\r\nZoneId=3\r\n'); },
    writeFile: async (file) => { calls.push(['write', file]); },
    run: async (cmd, args) => { calls.push(['run', cmd, ...args]); return { stdout: '0081;abc;Browser;' }; }
  });

  assert.strictEqual(om.downloadMark('https://x', deps('linux')), null);
  assert.match(om.downloadMark('https://x/a\r\nb', deps('win32')).data.toString(), /^\[ZoneTransfer\]\r\nZoneId=3\r\nHostUrl=https:\/\/x\/ab\r\n$/);
  assert.match(om.downloadMark('', deps('darwin')).value, /^0081;[0-9a-f]+;REVELation;$/);

  assert.strictEqual(await om.markDownloaded('/r', ['slides.md', 'pic.png'], 'https://x', deps('win32')), 0, 'text and media need no mark');
  assert.strictEqual(await om.markDownloaded('/r', ['talk.pdf', 'deck.pptx'], 'https://x', deps('win32')), 2);
  assert.deepStrictEqual(calls.filter((c) => c[0] === 'write').map((c) => c[1]).map((p) => p.replace(/\\/g, '/')),
    ['/r/talk.pdf:Zone.Identifier', '/r/deck.pptx:Zone.Identifier']);

  calls.length = 0;
  assert.strictEqual(await om.propagateOriginMark('/in.revel', '/r', ['talk.pdf'], deps('linux')), 0);
  assert.strictEqual(await om.propagateOriginMark('/in.revel', '/r', ['talk.pdf'], deps('darwin')), 1);
  assert.ok(calls.some((c) => c[0] === 'run' && c.includes('-w')));
});
