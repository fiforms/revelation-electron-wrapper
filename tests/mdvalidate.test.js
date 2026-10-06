// plugins/mdvalidate: the markdown validator, run against small temp presentations.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { installElectronStub } = require('./helpers/electron-stub');
const { tmpDir } = require('./helpers/paths');

installElectronStub();
const plugin = require('../plugins/mdvalidate/plugin');

function setup(markdown) {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'demo', '_media'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'demo', 'presentation.md'), markdown);
  const ctx = { config: { presentationsDir: dir }, log() {}, error() {} };
  plugin.register(ctx);
  return { dir, run: (data) => plugin.api.validate(null, data) };
}

const levels = (report) => Object.fromEntries(report.checks.map((c) => [c.id, c.level]));

test('requires a slug and reports missing files', async () => {
  const { dir, run } = setup('# x');
  assert.match((await run({})).error, /slug is required/);
  assert.match((await run({ slug: 'demo', mdFile: 'nope.md' })).error, /not found/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a well-formed presentation yields a report with no failures', async () => {
  const { dir, run } = setup('---\ntitle: Demo\ntheme: black.css\n---\n\n# One\n\n---\n\n# Two\n');
  const report = await run({ slug: 'demo' });
  assert.ok(Array.isArray(report.checks) && report.checks.length > 3);
  assert.deepStrictEqual(report.checks.filter((c) => c.level === 'fail').map((c) => c.id), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('missing required YAML fields (title, theme) fail the header check', async () => {
  const { dir, run } = setup('---\nauthor: me\n---\n\n# One\n');
  const header = (await run({ slug: 'demo' })).checks.find((c) => c.id === 'yaml-header');
  assert.strictEqual(header.level, 'fail');
  assert.ok(header.errors.some((e) => /title/.test(e)) && header.errors.some((e) => /theme/.test(e)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('broken YAML and an unclosed code fence are flagged', async () => {
  const { dir, run } = setup('---\ntitle: [unclosed\n---\n\n# One\n\n```js\nnever closed\n');
  const l = levels(await run({ slug: 'demo' }));
  assert.strictEqual(l['yaml-header'], 'fail');
  assert.ok(Object.values(l).includes('fail'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a link to a missing media file fails the media check', async () => {
  const { dir, run } = setup('---\ntitle: Demo\ntheme: black.css\n---\n\n![x](_media/missing.png)\n');
  const report = await run({ slug: 'demo' });
  const failing = report.checks.filter((c) => c.level === 'fail');
  assert.ok(failing.some((c) => c.errors.join(' ').includes('missing.png')), JSON.stringify(failing));
  fs.rmSync(dir, { recursive: true, force: true });
});
