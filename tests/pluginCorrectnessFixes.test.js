// Regression tests for the "Correctness: plugins" fixes: virtualbiblesnapshots (no overwrite), mediashare
// (YAML/alt escaping, stale temp folders), popplerpdf (save only on change), mediafx (log once, prune),
// adventisthymns (fetch timeout).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { installElectronStub } = require('./helpers/electron-stub');
const { tmpDir } = require('./helpers/paths');

installElectronStub();

test('virtualbiblesnapshots: fetch-to-presentation never overwrites an existing file or sidecar', async () => {
  const mediaLibrary = require('../lib/mediaLibrary');
  const dir = tmpDir();
  const pres = path.join(dir, 'demo');
  fs.mkdirSync(pres);
  const original = mediaLibrary.downloadToTemp;
  let n = 0;
  mediaLibrary.downloadToTemp = async () => {
    const f = path.join(dir, `dl-${n++}.tmp`);
    fs.writeFileSync(f, `body ${n}`);
    return f;
  };
  try {
    const plugin = require('../plugins/virtualbiblesnapshots/plugin');
    plugin.register({ log() {}, warn() {}, error() {}, config: { presentationsDir: dir }, plugins: {} });
    const item = { ftype: 'image', medurl: 'https://example.org/a/pic.jpg', filename: 'pic.jpg' };
    const first = await plugin.api['fetch-to-presentation'](null, { slug: 'demo', item });
    const second = await plugin.api['fetch-to-presentation'](null, { slug: 'demo', item });
    assert.strictEqual(first.filename, 'pic.jpg');
    assert.strictEqual(second.filename, 'pic-1.jpg');
    assert.strictEqual(fs.readFileSync(path.join(pres, 'pic.jpg'), 'utf8'), 'body 1');
    assert.strictEqual(fs.readFileSync(path.join(pres, 'pic-1.jpg'), 'utf8'), 'body 2');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(pres, 'pic-1.jpg.json'), 'utf8')).filename, 'pic-1.jpg');
  } finally {
    mediaLibrary.downloadToTemp = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mediashare: filenames with backslashes, quotes and markup stay valid YAML and an escaped alt', () => {
  const { buildPresentationMarkdown } = require('../plugins/mediashare/plugin');
  const name = 'a\\b "q" <x>&.png';
  const md = buildPresentationMarkdown('/media-share/tok', 'image', name);
  const front = md.split('---')[1];
  assert.strictEqual(yaml.load(front).title, `Media Share: ${name}`);
  assert.ok(md.includes('alt="a\\b &quot;q&quot; &lt;x&gt;&amp;.png"'));
  assert.ok(!md.split('---')[2].includes('<x>'));
});

test('mediashare: removeStaleTempDirs removes only _mediashare_<hex> folders', () => {
  const { removeStaleTempDirs } = require('../plugins/mediashare/plugin');
  const dir = tmpDir();
  const stale = '_mediashare_0123456789abcdef';
  for (const d of [stale, 'real-deck', '_mediashare_notes']) fs.mkdirSync(path.join(dir, d));
  assert.strictEqual(removeStaleTempDirs(dir), 1);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['_mediashare_notes', 'real-deck']);
  assert.strictEqual(removeStaleTempDirs(path.join(dir, 'missing')), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('popplerpdf: register saves the config only when the paths changed', () => {
  const configManager = require('../lib/configManager');
  let saves = 0;
  const original = configManager.saveConfig;
  configManager.saveConfig = () => { saves++; };
  try {
    const plugin = require('../plugins/popplerpdf/plugin');
    plugin.findPopplerRoot = () => '/fake/poppler';
    plugin.toolPaths = () => ({ pdftoppmPath: '/fake/pdftoppm', pdfinfoPath: '/fake/pdfinfo' });
    const realExists = fs.existsSync;
    fs.existsSync = (p) => (String(p).startsWith('/fake/') ? true : realExists(p));
    try {
      const ctx = { log() {}, config: {}, plugins: {} };
      plugin.register(ctx);
      assert.strictEqual(saves, 1);
      plugin.register(ctx);
      assert.strictEqual(saves, 1, 'unchanged paths must not save again');
      ctx.config.pluginConfigs.addmedia.pdfinfoPath = '/other';
      plugin.register(ctx);
      assert.strictEqual(saves, 2);
    } finally {
      fs.existsSync = realExists;
    }
  } finally {
    configManager.saveConfig = original;
  }
});

test('mediafx: getEnv logs the ffmpeg path once and finished jobs are pruned', () => {
  const plugin = require('../plugins/mediafx/plugin');
  const logs = [];
  plugin.register({ log: (m) => logs.push(m), config: {}, ffmpegPath: '/usr/bin/ffmpeg' });
  plugin._getEnv();
  const env = plugin._getEnv();
  assert.strictEqual(env.FFMPEG_PATH, '/usr/bin/ffmpeg');
  assert.strictEqual(logs.filter((l) => l.includes('using FFMPEG_PATH')).length, 1);

  const map = plugin._runningProcesses;
  map.clear();
  map.set('run', { status: 'running' });
  for (let i = 0; i < 5; i++) map.set(`done${i}`, { status: 'completed' });
  plugin._pruneFinishedProcesses(2);
  assert.deepStrictEqual([...map.keys()], ['run', 'done3', 'done4']);
  map.clear();
});

test('adventisthymns: every fetch carries an abort signal', async () => {
  const service = require('../plugins/adventisthymns/service');
  const originalFetch = global.fetch;
  const signals = [];
  global.fetch = async (_url, opts) => {
    signals.push(opts && opts.signal);
    return { ok: true, text: async () => 'Verse one\n\nVerse two', json: async () => [], url: _url };
  };
  try {
    await service.fetchPublicDomainLyrics({ number: '1', logger: { log() {}, warn() {}, error() {} } }).catch(() => {});
    assert.strictEqual(signals.length, 1);
    assert.ok(signals[0] instanceof AbortSignal);
  } finally {
    global.fetch = originalFetch;
  }
});
