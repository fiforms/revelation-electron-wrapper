// Plugin credentials must not reach browsers. plugins.json is served at
// /plugins_<key>/plugins.json and get-plugin-list feeds the builder/Add Media pages, so both go through
// lib/pluginConfigView.js. Settings (includeSecrets) still gets everything so saving never loses a secret.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { installElectronStub, electronStub } = require('./helpers/electron-stub');
const { tmpDir } = require('./helpers/paths');
const { ROOT } = require('./helpers/paths');

installElectronStub();

const { secretConfigKeys, browserSafeConfig } = require('../lib/pluginConfigView');
const { pluginDirector } = require('../lib/pluginDirector');

const SECRET = 'S3CR3T-VALUE';
const load = (name) => require(path.join(ROOT, 'plugins', name, 'plugin.js'));

// A plugin the way the loader leaves it: the module object with `config` filled in.
const loaded = (name, config) => Object.assign(Object.create(load(name)), { config, version: '0.0.0' });

test('secret fields and privateConfigKeys are removed; everything else is kept; nothing is mutated', () => {
  const plugin = {
    configTemplate: [{ name: 'apiKey', secret: true }, { name: 'mode' }, { name: 'flag', secret: false }, null],
    privateConfigKeys: ['extraToken'],
    config: { apiKey: SECRET, mode: 'x', flag: true, extraToken: SECRET, undeclared: 1 }
  };
  assert.deepStrictEqual([...secretConfigKeys(plugin)].sort(), ['apiKey', 'extraToken']);
  assert.deepStrictEqual(browserSafeConfig(plugin), { mode: 'x', flag: true, undeclared: 1 });
  assert.strictEqual(plugin.config.apiKey, SECRET, 'the real config is untouched');
});

test('a plugin with no secrets gets its config back unchanged; odd inputs do not throw', () => {
  const config = { a: 1 };
  assert.strictEqual(browserSafeConfig({ config }), config);
  assert.strictEqual(browserSafeConfig({}), undefined);
  assert.strictEqual(browserSafeConfig(null), undefined);
  assert.deepStrictEqual(browserSafeConfig({ config: {}, configTemplate: 'nope', privateConfigKeys: 5 }), {});
});

test('guard: a config field whose name looks like a credential must be marked secret', () => {
  const looksSecret = /key|token|secret|passw|credential|auth/i;
  const problems = [];
  for (const entry of fs.readdirSync(path.join(ROOT, 'plugins'), { withFileTypes: true })) {
    if (!entry.isDirectory() || !fs.existsSync(path.join(ROOT, 'plugins', entry.name, 'plugin.js'))) continue;
    for (const field of load(entry.name).configTemplate || []) {
      if (looksSecret.test(field.name) && field.secret !== true) problems.push(`${entry.name}.${field.name}`);
    }
  }
  assert.deepStrictEqual(problems, [], 'mark these with `secret: true` in their configTemplate (lib/pluginConfigView.js)');
});

test('the credentials in the bundled plugins are all marked', () => {
  assert.ok(secretConfigKeys(load('bibletext')).has('esvApiKey'));
  assert.ok(secretConfigKeys(load('infopanel')).has('password'));
  assert.ok(secretConfigKeys(load('infopanel')).has('username'));
  assert.ok(secretConfigKeys(load('wordpress_publish')).has('pairings'), 'pairings holds each publishToken');
});

function context() {
  const plugins = {
    bibletext: loaded('bibletext', { esvApiKey: SECRET, bibleAPI: 'https://bible-api.com', defaultTranslation: 'KJV.local' }),
    infopanel: loaded('infopanel', { url: 'https://panel.example', username: SECRET, password: SECRET, panelPosition: 'bottom', panelSize: 25 }),
    wordpress_publish: loaded('wordpress_publish', {
      pairings: [{ siteBaseUrl: 'https://wp.example', pairingId: 'p1', publishToken: SECRET }],
      maxUploadRequestBytes: 921600,
      uploadChunkSizeBytes: 8388608
    }),
    // Not in its configTemplate, but the client reads it: it must keep reaching the browser.
    slidecontrol: loaded('slidecontrol', { allowControlFromAnyClient: true })
  };
  return { plugins, config: { key: 'abc123', viteServerPort: 8000 }, hostURL: 'localhost', log() {}, error() {} };
}

test('plugins.json content carries no credentials but keeps the settings clients read', () => {
  const index = pluginDirector.buildPluginsIndex(context());
  assert.ok(!JSON.stringify(index).includes(SECRET), 'no secret value anywhere in plugins.json');
  assert.deepStrictEqual(index.bibletext.config, { bibleAPI: 'https://bible-api.com', defaultTranslation: 'KJV.local' });
  assert.deepStrictEqual(index.infopanel.config, { url: 'https://panel.example', panelPosition: 'bottom', panelSize: 25 });
  assert.deepStrictEqual(index.wordpress_publish.config, { maxUploadRequestBytes: 921600, uploadChunkSizeBytes: 8388608 });
  assert.deepStrictEqual(index.slidecontrol.config, { allowControlFromAnyClient: true });
  assert.strictEqual(index.bibletext.baseURL, '/plugins_abc123/bibletext');
});

test('building the index leaves the live plugin config intact for the main process', () => {
  const ctx = context();
  pluginDirector.buildPluginsIndex(ctx);
  assert.strictEqual(ctx.plugins.bibletext.config.esvApiKey, SECRET);
  assert.strictEqual(ctx.plugins.infopanel.config.password, SECRET);
  assert.strictEqual(ctx.plugins.wordpress_publish.config.pairings[0].publishToken, SECRET);
});

test('get-plugin-list: filtered by default and for the sidebar form, full only for includeSecrets', async () => {
  // register() resets AppContext.plugins and writes plugins.json into the plugin folder. In dev mode that
  // folder is the real plugins/ directory, so run it as "packaged" against a temp folder instead.
  const realIndex = path.join(ROOT, 'plugins', 'plugins.json');
  const realBefore = fs.existsSync(realIndex) ? fs.statSync(realIndex).mtimeMs : null;

  const handlers = {};
  const live = context();
  const ctx = { ...live, plugins: {}, callbacks: {}, translate: (s) => s };
  ctx.config = { ...live.config, pluginFolder: tmpDir(), plugins: [], pluginConfigs: {} };
  electronStub.app.isPackaged = true;
  try {
    pluginDirector.register({ handle: (channel, fn) => { handlers[channel] = fn; }, on() {}, once() {} }, ctx);
  } finally {
    electronStub.app.isPackaged = false;
  }
  ctx.plugins = live.plugins; // register() emptied it; put the test plugins back
  const list = handlers['get-plugin-list'];

  for (const options of [undefined, false, true, { withTemplate: true }, { includeSecrets: false }, { includeSecrets: 'yes' }]) {
    const result = await list({}, options);
    assert.ok(!JSON.stringify(result).includes(SECRET), `options ${JSON.stringify(options)} must not return credentials`);
    assert.strictEqual(result.slidecontrol.config.allowControlFromAnyClient, true);
  }

  const full = await list({}, { withTemplate: true, includeSecrets: true });
  assert.strictEqual(full.bibletext.config.esvApiKey, SECRET, 'Settings needs the real values to edit and save');
  assert.strictEqual(full.infopanel.config.password, SECRET);
  assert.strictEqual(full.wordpress_publish.config.pairings[0].publishToken, SECRET);
  assert.ok(full.bibletext.configTemplate.some((f) => f.name === 'esvApiKey'), 'template still included');

  const realAfter = fs.existsSync(realIndex) ? fs.statSync(realIndex).mtimeMs : null;
  assert.strictEqual(realAfter, realBefore, 'the test must not rewrite the real plugins/plugins.json');
});
