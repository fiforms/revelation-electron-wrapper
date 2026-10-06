// Plugin layout rules: manifests are complete, ids match folder names, and every plugin enabled
// on first run actually exists.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { installElectronStub } = require('./helpers/electron-stub');
const { ROOT } = require('./helpers/paths');

installElectronStub();

const pluginsDir = path.join(ROOT, 'plugins');
const dirs = fs.readdirSync(pluginsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

test('every plugin folder has a complete plugin-manifest.json', () => {
  const problems = [];
  for (const name of dirs) {
    const manifestPath = path.join(pluginsDir, name, 'plugin-manifest.json');
    if (!fs.existsSync(manifestPath)) { problems.push(`${name}: missing plugin-manifest.json`); continue; }
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const field of ['id', 'title', 'description', 'plugin_version']) {
      if (!m[field]) problems.push(`${name}: manifest missing "${field}"`);
    }
    if (m.id !== name) problems.push(`${name}: manifest id "${m.id}" does not match folder name`);
    if (m.plugin_version && !/^\d+\.\d+\.\d+/.test(m.plugin_version)) problems.push(`${name}: bad plugin_version "${m.plugin_version}"`);
    if (!fs.existsSync(path.join(pluginsDir, name, 'plugin.js'))) problems.push(`${name}: missing plugin.js`);
  }
  assert.deepStrictEqual(problems, []);
});

test('files named by clientHookJS / builderHookJS exist', () => {
  const problems = [];
  for (const name of dirs) {
    const pluginFile = path.join(pluginsDir, name, 'plugin.js');
    if (!fs.existsSync(pluginFile)) continue;
    const plugin = require(pluginFile);
    for (const key of ['clientHookJS', 'builderHookJS']) {
      if (plugin[key] && !fs.existsSync(path.join(pluginsDir, name, plugin[key]))) {
        problems.push(`${name}: ${key} "${plugin[key]}" not found`);
      }
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('plugins that define api{} expose functions only', () => {
  const problems = [];
  for (const name of dirs) {
    const pluginFile = path.join(pluginsDir, name, 'plugin.js');
    if (!fs.existsSync(pluginFile)) continue;
    const plugin = require(pluginFile);
    for (const group of ['api', 'presentationApi']) {
      for (const [key, value] of Object.entries(plugin[group] || {})) {
        if (typeof value !== 'function') problems.push(`${name}.${group}.${key} is not a function`);
      }
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('defaultPlugins in configManager all exist in plugins/', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'configManager.js'), 'utf8');
  const match = src.match(/const defaultPlugins = (\[[^\]]*\])/);
  assert.ok(match, 'defaultPlugins array not found');
  const names = JSON.parse(match[1]);
  const missing = names.filter((n) => !dirs.includes(n));
  assert.deepStrictEqual(missing, []);
});
