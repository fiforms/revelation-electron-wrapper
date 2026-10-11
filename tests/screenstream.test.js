// Screen Stream plugin: ffmpeg command building for each platform/backend, RIST URL validation,
// capability parsing. Pure logic only; the capture window and process handling need Electron.
const test = require('node:test');
const assert = require('node:assert');
const {
  resolveBackend, buildRistUrl, buildFfmpegArgs, resolveEncryption, parseAvfoundationScreens, toPhysicalRect, supportsRist
} = require('../plugins/screenstream/streamCommand');

const base = { fps: 30, bitrateKbps: 6000, scaleHeight: 0, encoder: 'libx264', cursor: true,
  ristUrl: 'rist://10.0.0.5:5000', rect: { x: 1920, y: 0, width: 2560, height: 1440 } };

test('resolveBackend: auto uses the browser only on Linux Wayland', () => {
  assert.strictEqual(resolveBackend('auto', 'linux', { XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' }), 'browser');
  assert.strictEqual(resolveBackend('auto', 'linux', { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }), 'ffmpeg');
  assert.strictEqual(resolveBackend('auto', 'win32', { XDG_SESSION_TYPE: 'wayland' }), 'ffmpeg');
  assert.strictEqual(resolveBackend('browser', 'win32', {}), 'browser');
  assert.strictEqual(resolveBackend('ffmpeg', 'linux', { XDG_SESSION_TYPE: 'wayland' }), 'ffmpeg');
});

test('buildRistUrl: hosts and ports', () => {
  assert.strictEqual(buildRistUrl({ host: '10.0.0.5', port: 5000 }), 'rist://10.0.0.5:5000');
  assert.strictEqual(buildRistUrl({ host: 'rx.example.com', port: '6000' }), 'rist://rx.example.com:6000');
  assert.strictEqual(buildRistUrl({ host: 'fe80::1', port: 5000 }), 'rist://[fe80::1]:5000');
  assert.strictEqual(buildRistUrl({ host: '[::1]', port: 5000 }), 'rist://[::1]:5000');
});

test('latency becomes -buffer_size just before the URL, and is omitted at 0', () => {
  let args = buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'win32', env: {}, latencyMs: 500 });
  assert.deepStrictEqual(args.slice(-3), ['-buffer_size', '500', base.ristUrl]);
  args = buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'win32', env: {}, latencyMs: 0 });
  assert.ok(!args.includes('-buffer_size'));
  assert.strictEqual(args[args.length - 1], base.ristUrl);
});

test('buildRistUrl rejects empty, injected and out-of-range values', () => {
  for (const host of ['', '  ', 'a/b', 'a?x=1', 'a@b', 'a b', 'host#x', 'x\ny']) {
    assert.throws(() => buildRistUrl({ host, port: 5000 }), undefined, JSON.stringify(host));
  }
  for (const port of [0, 65536, 'abc', 1.5, undefined]) {
    assert.throws(() => buildRistUrl({ host: '10.0.0.5', port }), undefined, String(port));
  }
});

test('Windows capture uses gdigrab with the screen rectangle', () => {
  const args = buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'win32', env: {} });
  const i = args.indexOf('gdigrab');
  assert.deepStrictEqual(args.slice(i - 1, i + 1), ['-f', 'gdigrab']);
  assert.ok(args.join(' ').includes('-offset_x 1920 -offset_y 0 -video_size 2560x1440 -i desktop'));
  assert.strictEqual(args[args.length - 1], base.ristUrl);
});

test('X11 capture uses x11grab at the screen offset', () => {
  const args = buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'linux', env: { DISPLAY: ':1.0' } });
  assert.ok(args.join(' ').includes('-f x11grab'));
  assert.ok(args.includes(':1.0+1920,0'));
});

test('macOS capture uses the avfoundation index and needs one', () => {
  const args = buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'darwin', env: {}, avfIndex: 2 });
  assert.ok(args.join(' ').includes('-f avfoundation'));
  assert.ok(args.includes('2:none'));
  assert.throws(() => buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'darwin', env: {} }));
});

test('browser backend reads WebM from stdin and fixes the frame rate', () => {
  const args = buildFfmpegArgs({ ...base, backend: 'browser', platform: 'linux', env: {} });
  assert.ok(args.join(' ').includes('-f webm -i pipe:0'));
  assert.ok(args[args.indexOf('-vf') + 1].startsWith('fps=30,'));
  assert.ok(!args.includes('x11grab'));
});

test('encoding: even dimensions, scaling, bitrate, mpegts output', () => {
  let args = buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'win32', env: {} });
  assert.strictEqual(args[args.indexOf('-vf') + 1], 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
  assert.ok(args.join(' ').includes('-preset veryfast -tune zerolatency'));
  assert.ok(args.join(' ').includes('-b:v 6000k -maxrate 6000k'));
  assert.ok(args.join(' ').includes('-f mpegts rist://'));
  args = buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'win32', env: {}, scaleHeight: 721, encoder: 'h264_nvenc' });
  assert.strictEqual(args[args.indexOf('-vf') + 1], 'scale=-2:722');
  assert.ok(!args.includes('-preset'));
});

test('encoder names are restricted', () => {
  assert.throws(() => buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'win32', env: {}, encoder: 'libx264 -y' }));
});

test('toPhysicalRect scales by DPI and keeps sizes even', () => {
  const display = { bounds: { x: 100, y: 0, width: 1281, height: 721 }, scaleFactor: 2 };
  assert.deepStrictEqual(toPhysicalRect(display), { x: 200, y: 0, width: 2562, height: 1442 });
  const viaElectron = toPhysicalRect(display, (_w, b) => ({ x: b.x, y: b.y, width: b.width, height: b.height }));
  assert.deepStrictEqual(viaElectron, { x: 100, y: 0, width: 1280, height: 720 });
});

test('capability parsing', () => {
  assert.ok(supportsRist(' Output:\n  rist\n  rtmp\n'));
  assert.ok(!supportsRist(' Output:\n  rtmp\n  tcp\n'));
  const out = '[AVFoundation indev] [0] FaceTime HD Camera\n[AVFoundation indev] [1] Capture screen 0\n' +
    '[AVFoundation indev] [2] Capture screen 1\n';
  assert.deepStrictEqual(parseAvfoundationScreens(out), [
    { index: 1, name: 'Capture screen 0' }, { index: 2, name: 'Capture screen 1' }
  ]);
});

test('browser passthrough copies H.264 instead of re-encoding', () => {
  const args = buildFfmpegArgs({ ...base, backend: 'browser', passthrough: true, platform: 'linux', env: {}, latencyMs: 500 });
  assert.ok(args.join(' ').includes('-f webm -i pipe:0 -an -c:v copy -f mpegts -buffer_size 500 rist://'));
  for (const flag of ['-vf', '-b:v', '-preset']) assert.ok(!args.includes(flag), flag);
  // passthrough never applies to the ffmpeg-grab backend
  const grab = buildFfmpegArgs({ ...base, backend: 'ffmpeg', passthrough: true, platform: 'win32', env: {} });
  assert.ok(grab.includes('-vf') && !grab.includes('copy'));
});

test('encryption: -secret/-encryption go before the URL, on both capture paths, and only when enabled', () => {
  const pass = 'pass&w?rd#123 x';
  for (const extra of [{ backend: 'ffmpeg', platform: 'win32' }, { backend: 'browser', platform: 'linux' },
    { backend: 'browser', platform: 'linux', passthrough: true }]) {
    const args = buildFfmpegArgs({ ...base, ...extra, env: {}, latencyMs: 300, encryption: '128', secret: pass });
    assert.deepStrictEqual(args.slice(-7), ['-buffer_size', '300', '-secret', pass, '-encryption', '128', base.ristUrl]);
    assert.ok(!args.join(' ').includes('?secret'), 'passphrase must not be in the URL');
  }
  const off = buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'win32', env: {}, encryption: 'none', secret: 'x' });
  assert.ok(!off.includes('-secret') && !off.includes('-encryption'));
});

test('resolveEncryption validates mode and passphrase', () => {
  assert.strictEqual(resolveEncryption('none', ''), '');
  assert.strictEqual(resolveEncryption(undefined, ''), '');
  assert.strictEqual(resolveEncryption('128', 'passphrase'), '128');
  assert.strictEqual(resolveEncryption(256, 'passphrase'), '256');
  assert.throws(() => resolveEncryption('128', ''), /passphrase/);
  assert.throws(() => resolveEncryption('64', 'passphrase'));
  assert.throws(() => resolveEncryption('128', 'x'.repeat(128)));
});
