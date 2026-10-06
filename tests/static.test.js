// Static checks over the whole wrapper: syntax, JSON validity, header comments, and that
// every renderer->main IPC channel has a handler. None of this executes application code.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, walk, rel } = require('./helpers/paths');

const SKIP_DIRS = ['/WordPress/', '/dist/', '/package/', '/revelation/', '/vendor/', '/http_admin/'];
const notSkipped = (f) => !SKIP_DIRS.some((d) => f.includes(d));

// Files that run under Node (main process, preloads, plugin main halves, build scripts).
function nodeSources() {
  const rootFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, f));
  const dirs = ['lib', 'scripts', 'plugins'].flatMap((d) =>
    walk(path.join(ROOT, d), (f) => f.endsWith('.js') && notSkipped(f)));
  return [...rootFiles, ...dirs].filter((f) => !/\/plugins\/[^/]+\/(client|builder)\.js$/.test(f));
}

test('main-process JS files pass node --check', () => {
  const failures = [];
  for (const file of nodeSources()) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status !== 0) failures.push(`${rel(file)}\n${r.stderr.trim()}`);
  }
  assert.deepStrictEqual(failures, [], failures.join('\n\n'));
});

test('browser-side JS files parse (module or script)', () => {
  const vm = require('vm');
  const { tmpDir } = require('./helpers/paths');
  const scratch = tmpDir();
  const files = [
    ...walk(path.join(ROOT, 'http_admin'), (f) => f.endsWith('.js') && !f.includes('/vendor/')),
    ...walk(path.join(ROOT, 'plugins'), (f) => /\/(client|builder)\.js$/.test(f))
  ];
  const failures = [];
  files.forEach((file, i) => {
    const src = fs.readFileSync(file, 'utf8');
    // These load as ES modules or classic scripts depending on the page, so accept either.
    const asModule = path.join(scratch, `${i}.mjs`);
    fs.writeFileSync(asModule, src);
    const r = spawnSync(process.execPath, ['--check', asModule], { encoding: 'utf8' });
    if (r.status === 0) return;
    try { new vm.Script(src, { filename: file }); } catch (err) { failures.push(`${rel(file)}: ${err.message}`); }
  });
  fs.rmSync(scratch, { recursive: true, force: true });
  assert.deepStrictEqual(failures, []);
});

test('every JSON file in the repo parses', () => {
  const files = walk(ROOT, (f) => f.endsWith('.json') && notSkipped(f) && !f.includes('package-lock'));
  const failures = [];
  for (const file of files) {
    try { JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { failures.push(`${rel(file)}: ${err.message}`); }
  }
  assert.deepStrictEqual(failures, []);
});

test('every lib/*.js module has a header comment near the top (project rule)', () => {
  const missing = fs.readdirSync(path.join(ROOT, 'lib'))
    .filter((f) => f.endsWith('.js'))
    .filter((f) => !fs.readFileSync(path.join(ROOT, 'lib', f), 'utf8').split('\n').slice(0, 20).some((l) => /^\s*(\/\/|\/\*)/.test(l)))
    .map((f) => `lib/${f}`);
  assert.deepStrictEqual(missing, []);
});

test('every ipcRenderer channel used by a preload has an ipcMain handler', () => {
  const channelRe = /ipcRenderer\.(invoke|sendSync)\(\s*['"]([^'"]+)['"]/g;
  const handlerRe = /ipcMain\.(?:handle|on|once)\(\s*['"]([^'"]+)['"]/g;
  const handled = new Set();
  const sources = [path.join(ROOT, 'main.js'),
    ...walk(path.join(ROOT, 'lib'), (f) => f.endsWith('.js')),
    ...walk(path.join(ROOT, 'plugins'), (f) => f.endsWith('.js'))];
  for (const file of sources) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(handlerRe)) handled.add(m[1]);
  }
  const missing = [];
  for (const file of fs.readdirSync(ROOT).filter((f) => /^preload.*\.js$/.test(f))) {
    for (const m of fs.readFileSync(path.join(ROOT, file), 'utf8').matchAll(channelRe)) {
      if (!handled.has(m[2])) missing.push(`${file}: ${m[2]}`);
    }
  }
  assert.deepStrictEqual(missing, [], 'channels invoked from a preload but never handled');
});
