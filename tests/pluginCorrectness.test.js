// Small main-process fixes in plugins: infopanel login handler, addmedia process-missing-media,
// test example-echo, compactor job pruning.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { installElectronStub } = require('./helpers/electron-stub');
const { tmpDir } = require('./helpers/paths');

const stub = installElectronStub();
const electron = require('electron');

test('infopanel: cancels a repeated challenge, resets state, and does not stack listeners', () => {
  const plugin = require('../plugins/infopanel/plugin');
  const listeners = [];
  const origOn = electron.app.on, origRemove = electron.app.removeListener;
  electron.app.on = (name, fn) => listeners.push(fn);
  electron.app.removeListener = (name, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  try {
    plugin.config = { url: 'http://panel.local/x', username: 'u', password: 'p' };
    const ctx = { log() {} };
    plugin.register(ctx);
    plugin.register(ctx);
    assert.strictEqual(listeners.length, 1);

    let loginHandler;
    listeners[0]({}, { webContents: { on: (n, fn) => { loginHandler = fn; } } });
    const challenge = () => {
      const calls = { prevented: 0, args: null };
      loginHandler({ preventDefault() { calls.prevented += 1; } }, {}, { host: 'panel.local' }, (...a) => { calls.args = a; });
      return calls;
    };
    assert.deepStrictEqual(challenge().args, ['u', 'p']);
    const second = challenge();
    assert.strictEqual(second.prevented, 1);
    assert.deepStrictEqual(second.args, []); // callback() was called, so the challenge is not left hanging
    assert.deepStrictEqual(challenge().args, ['u', 'p']); // state reset: a later attempt can try again
  } finally {
    electron.app.on = origOn;
    electron.app.removeListener = origRemove;
  }
});

test('addmedia process-missing-media: <>-wrapped links count as linked; malformed % does not throw; fit tag', async () => {
  const plugin = require('../plugins/addmedia/plugin');
  const dir = tmpDir();
  const pres = path.join(dir, 'demo');
  fs.mkdirSync(pres, { recursive: true });
  for (const f of ['my pic.png', 'a.png', 'b.jpg', 'c.mkv', 'd.mov']) fs.writeFileSync(path.join(pres, f), 'x');
  fs.writeFileSync(path.join(pres, 'presentation.md'), '# t\n\n![](<my pic.png>)\n\n![](100%.png)\n');
  plugin.register({ plugins: {}, config: { presentationsDir: dir }, log() {}, error() {} });
  const res = await plugin.api['process-missing-media'](null, { slug: 'demo', mdFile: 'presentation.md', tagType: 'fit' });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.count, 4); // a.png b.jpg c.mkv d.mov; "my pic.png" is already linked
  const md = fs.readFileSync(path.join(pres, 'presentation.md'), 'utf8');
  assert.match(md, /!\[fit\]\(a\.png\)/);
  assert.doesNotMatch(md, /!\[fit\]\(my%20pic\.png\)/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('test plugin: example-echo works without a registered AppContext', () => {
  const plugin = require('../plugins/test/plugin');
  assert.doesNotThrow(() => plugin.api['example-echo'](null, { a: 1 }));
  assert.deepStrictEqual(plugin.api['example-echo'].call({}, null, 5), { success: true, echo: 5 });
});

test('compactor: finished jobs are pruned when a new job starts', async () => {
  const plugin = require('../plugins/compactor/plugin');
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'demo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'demo', 'presentation.md'), '# t\n');
  plugin.register({ config: { presentationsDir: dir }, log() {}, error() {} });
  const a = await plugin.api.startCompaction(null, { slug: 'demo' });
  assert.ok(a.success, a.error);
  for (let i = 0; i < 200; i += 1) {
    const st = await plugin.api.getCompactionStatus(null, { jobId: a.jobId });
    if (['done', 'failed', 'canceled'].includes(st.status)) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 60 * 60 * 1000;
  try {
    const b = await plugin.api.startCompaction(null, { slug: 'demo' });
    assert.ok(b.success, b.error);
    assert.strictEqual((await plugin.api.getCompactionStatus(null, { jobId: a.jobId })).success, false);
    assert.strictEqual((await plugin.api.getCompactionStatus(null, { jobId: b.jobId })).success, true);
  } finally {
    Date.now = realNow;
  }
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(dir, { recursive: true, force: true });
});
