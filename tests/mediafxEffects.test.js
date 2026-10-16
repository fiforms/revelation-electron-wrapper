// mediafx ffmpeg effects (plugins/mediafx/ffmpeg-effects.json): every effect's filtergraph, rendered with its default
// option values, must be accepted by a real ffmpeg. Regression: Posterize used a `posterize` filter ffmpeg does not have.
// Skipped when no ffmpeg is on PATH (CLI only; nothing here launches a GUI).
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');

const effects = require('../plugins/mediafx/ffmpeg-effects.json');
const list = Array.isArray(effects) ? effects : (effects.effects || Object.values(effects));
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

function render(vf, values) {
  return vf.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => (values[key] === undefined ? '' : String(values[key])));
}
function defaults(effect) {
  const values = {};
  (effect.options || []).forEach((o) => { values[o.name] = o.default; });
  return values;
}
function runFilter(vf, extraArgs = []) {
  return spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=d=1:s=320x240:r=10',
    '-vf', vf, ...extraArgs], { encoding: 'buffer' });
}

for (const effect of list) {
  test(`mediafx effect "${effect.name}" renders a filter ffmpeg accepts`, { skip: !hasFfmpeg && 'ffmpeg not on PATH' }, () => {
    const result = runFilter(`${render(effect.vf, defaults(effect))},format=yuv420p`, ['-f', 'null', '-']);
    assert.strictEqual(result.status, 0, String(result.stderr));
  });
}

test('mediafx Posterize yields exactly the requested number of levels', { skip: !hasFfmpeg && 'ffmpeg not on PATH' }, () => {
  const effect = list.find((e) => e.name === 'Posterize');
  for (const levels of [2, 4, 16]) {
    const result = runFilter(render(effect.vf, { levels }), ['-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    assert.strictEqual(result.status, 0, String(result.stderr));
    const distinct = new Set(result.stdout).size;
    assert.strictEqual(distinct, levels);
  }
});

// The UI's audio choices are passed to `-c:a`; opus and vorbis must name the library encoders because the same-named
// native encoders are experimental and refuse to run without `-strict -2`.
test('mediafx maps the UI audio codecs to usable ffmpeg encoders', () => {
  const { installElectronStub } = require('./helpers/electron-stub');
  installElectronStub();
  const plugin = require('../plugins/mediafx/plugin');
  const map = plugin._resolveAudioEncoder;
  assert.strictEqual(map('opus'), 'libopus');
  assert.strictEqual(map('vorbis'), 'libvorbis');
  assert.strictEqual(map('mp3'), 'libmp3lame');
  for (const same of ['aac', 'flac', 'copy', 'pcm_s16le']) assert.strictEqual(map(same), same);
  assert.strictEqual(map('constructor'), 'constructor');
});

test('mediafx audio encoders are accepted by ffmpeg when its build has them', { skip: !hasFfmpeg && 'ffmpeg not on PATH' }, () => {
  const { installElectronStub } = require('./helpers/electron-stub');
  installElectronStub();
  const plugin = require('../plugins/mediafx/plugin');
  const encoders = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout;
  for (const choice of ['aac', 'mp3', 'opus', 'vorbis', 'flac']) {
    const encoder = plugin._resolveAudioEncoder(choice);
    if (!new RegExp(`\\s${encoder}\\s`).test(encoders)) continue; // not built into this ffmpeg
    const result = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=d=0.2', '-c:a', encoder, '-f', 'null', '-']);
    assert.strictEqual(result.status, 0, `${choice} -> ${encoder}: ${result.stderr}`);
  }
});
