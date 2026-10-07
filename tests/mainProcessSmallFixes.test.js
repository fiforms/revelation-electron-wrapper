// Regression tests for the smaller main-process fixes (KNOWN_ISSUES C5): overlapping fade-to-black calls,
// waiting on an already-dead Vite, config defaults not shared, in-memory docs plugin index, export timeouts,
// splash fallback timer during first run, the builder's single-window answer, peer refresh re-entrancy,
// and update-check errors that survive IPC.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { installElectronStub, electronStub, userData } = require('./helpers/electron-stub');

installElectronStub();

test('requestFadeToBlack: overlapping calls all resolve (none is left pending)', async () => {
  const { presentationWindow } = require('../lib/presentationWindow');
  const sent = [];
  presentationWindow.presWindow = { webContents: { send: (channel) => sent.push(channel) } };
  try {
    // Both time out: the old single-resolver code left the first promise pending forever.
    await Promise.all([presentationWindow.requestFadeToBlack(20), presentationWindow.requestFadeToBlack(20)]);
    assert.strictEqual(sent.length, 2);
    assert.deepStrictEqual(presentationWindow._fadeToBlackResolvers, []);
  } finally {
    presentationWindow.presWindow = null;
  }
  await presentationWindow.requestFadeToBlack(20); // no window: resolves immediately
});

test('waitForProcessExit: an already-exited process, an exit event and a silent process all resolve', async () => {
  const { waitForProcessExit, exitedProcesses } = require('../lib/serverManager');

  const dead = new EventEmitter();
  exitedProcesses.add(dead); // what startServers records when 'exit' fires
  await waitForProcessExit(dead, 10000);

  const exiting = new EventEmitter();
  setTimeout(() => exiting.emit('exit', 0), 10);
  await waitForProcessExit(exiting, 10000);

  const silent = new EventEmitter();
  const started = Date.now();
  await waitForProcessExit(silent, 50);
  assert.ok(Date.now() - started >= 40, 'fell back to the timeout');

  await waitForProcessExit(null);
});

test('loadConfig: results never share state with the defaults, and nested hotkeys get their defaults', () => {
  const cm = require('../lib/configManager');
  fs.writeFileSync(cm.configPath, JSON.stringify({ globalHotkeys: { next: 'N' } }));

  const first = cm.loadConfig();
  assert.strictEqual(first.globalHotkeys.next, 'N');
  assert.strictEqual(first.globalHotkeys.pipToggle, '', 'default for a hotkey the file does not have');
  first.plugins.push('not-a-real-plugin');
  first.globalHotkeys.blank = 'B';

  const second = cm.loadConfig();
  assert.ok(!second.plugins.includes('not-a-real-plugin'), 'plugins array is not shared');
  assert.strictEqual(second.globalHotkeys.blank, '');
  assert.notStrictEqual(first.plugins, second.plugins);
});

test('loadConfig: an unreadable config falls back to a private copy of the defaults', () => {
  const cm = require('../lib/configManager');
  fs.writeFileSync(cm.configPath, '{ not json');
  const a = cm.loadConfig();
  const b = cm.loadConfig();
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a.plugins, b.plugins);
  assert.ok(Array.isArray(a.plugins) && a.plugins.length > 0);
  fs.rmSync(cm.configPath, { force: true });
});

test('docs presentations: the plugin index is generated in memory and no temp file is left behind', () => {
  const { generateDocumentationPresentations } = require('../lib/docsPresentationBuilder');
  const root = path.resolve(__dirname, '..');
  const presentationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revelation-docs-test-'));
  const stray = () => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('.temp-plugin-index-'));
  const before = stray().length;
  try {
    const result = generateDocumentationPresentations({
      presentationsDir,
      revelationDir: path.join(root, 'revelation'),
      wrapperRoot: root,
      appVersion: '0.0.0-test'
    });
    assert.ok(result.generatedCount > 0);
    const index = result.generatedEntries.find((e) => e.key === 'doc/PLUGIN_INDEX.md');
    assert.ok(index, 'plugin index is still generated');
    const text = fs.readFileSync(path.join(result.readmePresDir, index.outputFile), 'utf8');
    assert.match(text, /Plugin Documentation Index/);
    assert.strictEqual(stray().length, before);
  } finally {
    fs.rmSync(presentationsDir, { recursive: true, force: true });
  }
});

test('docs presentations: a plugin translation under plugins/<id>/i18n/<lang>/ becomes an alternative of the English README', () => {
  const { generateDocumentationPresentations } = require('../lib/docsPresentationBuilder');
  const root = path.resolve(__dirname, '..');
  const presentationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revelation-docs-test-'));
  try {
    const result = generateDocumentationPresentations({
      presentationsDir,
      revelationDir: path.join(root, 'revelation'),
      wrapperRoot: root,
      appVersion: '0.0.0-test'
    });
    const en = result.generatedEntries.find((e) => e.key === 'plugins/addmedia/README.md');
    const es = result.generatedEntries.find((e) => e.key === 'plugins/addmedia/i18n/es/README.md');
    assert.ok(en && es, 'both the English README and its plugin-local Spanish translation are published');
    assert.strictEqual(es.outputFile, 'i18n/es/plugins/addmedia/README.md');
    const enText = fs.readFileSync(path.join(result.readmePresDir, en.outputFile), 'utf8');
    assert.match(enText, /i18n\/es\/plugins\/addmedia\/README\.md: es/);
  } finally {
    fs.rmSync(presentationsDir, { recursive: true, force: true });
  }
});

test('docs presentations: links in a translated page are root-relative and point at the translation (the viewer rejects `..`)', () => {
  const { generateDocumentationPresentations } = require('../lib/docsPresentationBuilder');
  const root = path.resolve(__dirname, '..');
  const presentationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revelation-docs-test-'));
  try {
    const result = generateDocumentationPresentations({
      presentationsDir,
      revelationDir: path.join(root, 'revelation'),
      wrapperRoot: root,
      appVersion: '0.0.0-test'
    });
    const es = fs.readFileSync(path.join(result.readmePresDir, 'i18n', 'es', 'QUICKSTART.md'), 'utf8');
    assert.match(es, /\]\(i18n\/es\/PLUGIN_INDEX\.md\)/, 'the plugin list link goes to the generated Spanish index');
    assert.match(es, /\]\(i18n\/es\/dev\/BUILDING\.md\)/, 'doc links go to the Spanish translation');
    assert.match(es, /\]\(i18n\/es\/plugins\/bibletext\/README\.md\)/, 'plugin links go to the plugin-local translation');
    assert.ok(!/\]\(\.\.\//.test(es), 'no link climbs out of the folder');
  } finally {
    fs.rmSync(presentationsDir, { recursive: true, force: true });
  }
});

test('exportWindow.withTimeout rejects a promise that never settles and passes real results through', async () => {
  const { withTimeout } = require('../lib/exportWindow');
  assert.strictEqual(await withTimeout(Promise.resolve(7), 1000, 'x'), 7);
  await assert.rejects(withTimeout(new Promise(() => {}), 20, 'Timed out'), /Timed out/);
  await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 1000, 'x'), /boom/);
});

test('splash: the 180 s fallback timer is paused while hidden for first run and re-armed after', () => {
  class FakeWindow {
    constructor() { this.destroyed = false; }
    once() { return this; }
    on() { return this; }
    loadFile() {}
    show() {} hide() {} close() { this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
  }
  const original = electronStub.BrowserWindow;
  electronStub.BrowserWindow = FakeWindow;
  try {
    const { splashWindow } = require('../lib/splashWindow');
    splashWindow.show();
    assert.ok(splashWindow._fallbackTimer, 'armed on show');
    splashWindow.hide();
    assert.strictEqual(splashWindow._fallbackTimer, null, 'paused while the first-run prompt is up');
    splashWindow.unhide();
    assert.ok(splashWindow._fallbackTimer, 're-armed once startup continues');
    splashWindow.close();
    assert.strictEqual(splashWindow._fallbackTimer, null);
  } finally {
    electronStub.BrowserWindow = original;
  }
});

test('builder: asking for a different presentation while one is open is reported, not claimed as success', () => {
  const { presentationBuilderWindow: builder } = require('../lib/presentationBuilderWindow');
  let focused = 0;
  const AppContext = { config: { presentationsDir: path.join(userData, 'pres') }, log() {}, error() {} };
  builder.currentWindow = { isDestroyed: () => false, focus: () => { focused += 1; } };
  builder.currentSlug = 'sermon';
  builder.currentMdFile = 'presentation.md';
  try {
    assert.deepStrictEqual(builder.open(AppContext, 'sermon', 'presentation.md'), { success: true });
    assert.deepStrictEqual(
      builder.open(AppContext, 'other-deck', 'presentation.md'),
      { success: false, reason: 'builder-busy', slug: 'sermon', mdFile: 'presentation.md' }
    );
    assert.deepStrictEqual(
      builder.open(AppContext, 'sermon', 'presentation.es.md'),
      { success: false, reason: 'builder-busy', slug: 'sermon', mdFile: 'presentation.md' }
    );
    assert.strictEqual(focused, 3);
  } finally {
    builder.currentWindow = null;
    builder.currentSlug = undefined;
    builder.currentMdFile = undefined;
  }
});

test('peerCommandClient.refreshConnection: a call made during a refresh joins it instead of starting another', async () => {
  const { peerCommandClient: client } = require('../lib/peerCommandClient');
  let runs = 0;
  let release;
  const original = client._refreshConnectionOnce;
  client._refreshConnectionOnce = () => { runs += 1; return new Promise((resolve) => { release = resolve; }); };
  try {
    const a = client.refreshConnection({});
    const b = client.refreshConnection({});
    assert.strictEqual(a, b);
    assert.strictEqual(runs, 1);
    release();
    await a;
    client.refreshConnection({}); // the guard is released afterwards
    assert.strictEqual(runs, 2);
    release();
  } finally {
    client._refreshConnectionOnce = original;
    client._refreshing = null;
  }
});

test('checkForUpdates: a failed check returns a string error (an Error object does not survive IPC)', async () => {
  const { checkForUpdates } = require('../lib/updateChecker');
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('network down'); };
  try {
    const result = await checkForUpdates({ config: { updateCheckEnabled: true }, error() {}, log() {} }, { force: true });
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.error, 'network down');
  } finally {
    global.fetch = realFetch;
  }
});

test('AppContext defines warn (mediaLibrary and a plugin call it)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'appContext.js'), 'utf8');
  assert.match(src, /^\s+warn\(\.\.\.args\) \{/m);
});

test('docs presentations: plugin READMEs and the index come from the given plugin folder', () => {
  const { generateDocumentationPresentations } = require('../lib/docsPresentationBuilder');
  const root = path.resolve(__dirname, '..');
  const presentationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revelation-docs-test-'));
  const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revelation-docs-plugins-'));
  try {
    fs.mkdirSync(path.join(pluginsDir, 'userplug'));
    fs.writeFileSync(path.join(pluginsDir, 'userplug', 'plugin-manifest.json'), JSON.stringify({ id: 'userplug', title: 'User Installed Plugin' }));
    fs.writeFileSync(path.join(pluginsDir, 'userplug', 'README.md'), '# User plugin\n');
    const result = generateDocumentationPresentations({
      presentationsDir, revelationDir: path.join(root, 'revelation'), wrapperRoot: root, pluginsDir, appVersion: '0.0.0-test'
    });
    const keys = result.generatedEntries.map((e) => e.key);
    assert.ok(keys.includes('plugins/userplug/README.md'));
    assert.ok(!keys.includes('plugins/widgets/README.md'), 'bundled plugins are not listed when another folder is given');
    const index = result.generatedEntries.find((e) => e.key === 'doc/PLUGIN_INDEX.md');
    assert.match(fs.readFileSync(path.join(result.readmePresDir, index.outputFile), 'utf8'), /User Installed Plugin/);
  } finally {
    fs.rmSync(presentationsDir, { recursive: true, force: true });
    fs.rmSync(pluginsDir, { recursive: true, force: true });
  }
});

test('pluginDirector: clearPluginRequireCache drops only modules inside the plugin folder', () => {
  const { clearPluginRequireCache } = require('../lib/pluginDirector');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revelation-plugin-cache-')); // not realpath'd on purpose: macOS tmpdir is a symlink
  try {
    fs.mkdirSync(path.join(dir, 'p'));
    fs.mkdirSync(path.join(dir, 'p2'));
    fs.writeFileSync(path.join(dir, 'p', 'plugin.js'), 'module.exports = { v: 1 };');
    fs.writeFileSync(path.join(dir, 'p2', 'plugin.js'), 'module.exports = { v: 1 };');
    assert.strictEqual(require(path.join(dir, 'p', 'plugin.js')).v, 1);
    require(path.join(dir, 'p2', 'plugin.js'));
    fs.writeFileSync(path.join(dir, 'p', 'plugin.js'), 'module.exports = { v: 2 };');
    clearPluginRequireCache(path.join(dir, 'p'));
    assert.strictEqual(require(path.join(dir, 'p', 'plugin.js')).v, 2);
    assert.ok(require.cache[fs.realpathSync(path.join(dir, 'p2', 'plugin.js'))], 'sibling folder with a shared name prefix is untouched');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
