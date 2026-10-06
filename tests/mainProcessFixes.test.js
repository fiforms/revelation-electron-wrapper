// Regression tests for the main-process fixes KNOWN_ISSUES used to list as C1-C4:
// single-instance lock first, auto-detected ffmpeg path never persisted, additional-screen displayId kept,
// and settings reset/delete actions reloading config (or relaunching) instead of leaving stale state.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { installElectronStub, electronStub, userData } = require('./helpers/electron-stub');

installElectronStub();
const { app, dialog } = electronStub;
const userDataDir = path.join(userData, 'userData');

test('C1: a second instance quits before loading config, touching userData or resetting the log', () => {
  let quit = 0;
  app.requestSingleInstanceLock = () => false;
  app.quit = () => { quit += 1; };
  try {
    require('../main.js');
  } finally {
    delete app.requestSingleInstanceLock;
    app.quit = () => {};
  }
  assert.strictEqual(quit, 1, 'app.quit() was called');
  assert.ok(!fs.existsSync(path.join(userDataDir, 'config.json')), 'config.json was not created');
  assert.ok(!fs.existsSync(path.join(userDataDir, 'resources')), 'no resource mirror was created');
});

test('C2: the auto-detected ffmpeg path is runtime-only and never written to config.json', () => {
  const { getActiveFfmpegPath } = require('../lib/ffmpegResolver');
  const cm = require('../lib/configManager');

  assert.strictEqual(getActiveFfmpegPath({ ffmpegPath: '/detected', config: { ffmpegPath: '/user' } }), '/detected');
  assert.strictEqual(getActiveFfmpegPath({ config: { ffmpegPath: '/user' } }), '/user');
  assert.strictEqual(getActiveFfmpegPath({ config: {} }), null);
  assert.strictEqual(getActiveFfmpegPath(undefined), null);

  const AppContext = { config: cm.loadConfig() };
  AppContext.ffmpegPath = '/tmp/stale-packaged/ffmpeg'; // what main.js sets after resolveFfmpegBinary()
  cm.saveConfig(AppContext.config);
  const saved = JSON.parse(fs.readFileSync(cm.configPath, 'utf8'));
  assert.ok(!JSON.stringify(saved).includes('stale-packaged'), 'detected path not persisted');
  assert.ok(!saved.ffmpegPath, 'config.ffmpegPath stays the (empty) user setting');
});

test('C2: main.js does not write the detected path into config', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(!/config\.ffmpegPath\s*=/.test(src));
  assert.match(src, /AppContext\.ffmpegPath = ffmpegBinary/);
});

test('C3: additional-screen normalization keeps the displayId fingerprint', () => {
  const { presentationWindow } = require('../lib/presentationWindow');
  const out = presentationWindow.normalizeAdditionalScreens([
    { target: 'display', displayIndex: 1, displayId: ' 1920x1080@1920,0 ', language: 'ES' },
    { target: 'display', displayId: '1280x720@0,0' },   // only a fingerprint: must survive
    { target: 'display' },                               // nothing to find a display by: dropped
    { target: 'window', displayId: 'x' },
    null
  ]);
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[0].displayId, '1920x1080@1920,0');
  assert.strictEqual(out[0].language, 'es');
  assert.strictEqual(out[1].displayId, '1280x720@0,0');
  assert.strictEqual(out[1].displayIndex, null);
  assert.deepStrictEqual(presentationWindow.normalizeAdditionalScreens('nope'), []);
  assert.match(presentationWindow.getAdditionalScreenSignature(out[0]), /1920x1080@1920,0/);
});

test('C3: there is one normalizeAdditionalScreens implementation', () => {
  const cm = require('../lib/configManager');
  const { presentationWindow } = require('../lib/presentationWindow');
  const input = [{ target: 'display', displayId: '10x10@0,0', muted: true }];
  assert.deepStrictEqual(presentationWindow.normalizeAdditionalScreens(input), cm.normalizeAdditionalScreens(input));
});

function settingsContext(calls) {
  return {
    config: { profile: 'Church' },
    win: { webContents: { send() {} } },
    translate: (s) => s,
    log() {},
    reloadConfig: () => { calls.push('reloadConfig'); },
    reloadServers: () => { calls.push('reloadServers'); }
  };
}

test('C4: resetProfile reloads config from disk before restarting servers', () => {
  const cm = require('../lib/configManager');
  const { settingsWindow } = require('../lib/settingsWindow');
  dialog.showMessageBoxSync = () => 1;
  fs.mkdirSync(cm.profilesDir, { recursive: true });
  const profilePath = path.join(cm.profilesDir, 'Church.config.json');
  fs.writeFileSync(profilePath, JSON.stringify({ profile: 'Church', language: 'es' }));

  const calls = [];
  settingsWindow.resetProfile(settingsContext(calls));

  assert.deepStrictEqual(calls, ['reloadConfig', 'reloadServers']);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(profilePath, 'utf8')), { profile: 'Church' });
});

test('C4: deleteProfile removes the file, switches to Default and reloads config via reloadConfig', () => {
  const cm = require('../lib/configManager');
  const { settingsWindow } = require('../lib/settingsWindow');
  dialog.showMessageBoxSync = () => 1;
  const profilePath = path.join(cm.profilesDir, 'Church.config.json');
  fs.writeFileSync(profilePath, JSON.stringify({ profile: 'Church' }));

  const calls = [];
  settingsWindow.deleteProfile(settingsContext(calls));

  assert.ok(!fs.existsSync(profilePath));
  assert.deepStrictEqual(calls, ['reloadConfig', 'reloadServers']);
});

test('C4: resetPlugins deletes the mirrors and relaunches instead of restarting Vite in place', () => {
  const { settingsWindow } = require('../lib/settingsWindow');
  dialog.showMessageBoxSync = () => 1;
  const resources = path.join(app.getPath('userData'), 'resources');
  for (const dir of ['plugins', 'revelation']) fs.mkdirSync(path.join(resources, dir), { recursive: true });
  const events = [];
  app.relaunch = () => events.push('relaunch');
  app.exit = (code) => events.push(`exit:${code}`);

  const calls = [];
  settingsWindow.resetPlugins(settingsContext(calls));

  assert.deepStrictEqual(calls, [], 'reloadServers must not run against deleted folders');
  assert.deepStrictEqual(events, ['relaunch', 'exit:0']);
  assert.ok(!fs.existsSync(path.join(resources, 'plugins')));
  assert.ok(!fs.existsSync(path.join(resources, 'revelation')));
});

test('C4: a cancelled reset changes nothing', () => {
  const { settingsWindow } = require('../lib/settingsWindow');
  dialog.showMessageBoxSync = () => 0;
  const calls = [];
  settingsWindow.resetProfile(settingsContext(calls));
  settingsWindow.resetPlugins(settingsContext(calls));
  settingsWindow.deleteProfile(settingsContext(calls));
  assert.deepStrictEqual(calls, []);
});
