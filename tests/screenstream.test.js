// Screen Stream plugin: ffmpeg command building for each platform/backend, RIST URL validation,
// capability parsing. Pure logic only; the capture window and process handling need Electron.
const test = require('node:test');
const assert = require('node:assert');
const {
  resolveBackend, buildRistUrl, buildFfmpegArgs, resolveEncryption, parseAvfoundationScreens, parsePactlSources, parseDshowAudio,
  parseAvfoundationAudio, resolveBitrate, toPhysicalRect, supportsRist
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

// ---- audio ----

test('audio device lists: pactl sources, dshow and avfoundation output', () => {
  const pactl = '53\talsa_output.pci-0000_04_00.6.analog-stereo.monitor\tPipeWire\ts32le 2ch 48000Hz\tSUSPENDED\n' +
    '54\talsa_input.pci-0000_04_00.6.analog-stereo\tPipeWire\ts32le 2ch 48000Hz\tSUSPENDED\n' +
    '55\tbad name with spaces\tPipeWire\ts16le\tIDLE\n';
  assert.deepStrictEqual(parsePactlSources(pactl), [
    { id: 'alsa_output.pci-0000_04_00.6.analog-stereo.monitor', label: 'System sound: alsa_output.pci-0000_04_00.6.analog-stereo' },
    { id: 'alsa_input.pci-0000_04_00.6.analog-stereo', label: 'Input: alsa_input.pci-0000_04_00.6.analog-stereo' }
  ]);

  const dshow = '[dshow @ 000001] "Integrated Camera" (video)\n[dshow @ 000001]   Alternative name "@device_pnp_x"\n' +
    '[dshow @ 000001] "Microphone (Realtek Audio)" (audio)\n[dshow @ 000001]   Alternative name "@device_cm_{33D9}\\wave_{1}"\n' +
    '[dshow @ 000001] "Stereo Mix (Realtek Audio)" (audio)\n[dshow @ 000001] "Odd:Name" (audio)\n[dshow @ 000001] "Odd=Name" (audio)\n';
  assert.deepStrictEqual(parseDshowAudio(dshow).map((d) => d.id), ['Microphone (Realtek Audio)', 'Stereo Mix (Realtek Audio)']);

  const avf = '[AVFoundation indev @ 0x1] AVFoundation video devices:\n[AVFoundation indev @ 0x1] [0] FaceTime HD Camera\n' +
    '[AVFoundation indev @ 0x1] [1] Capture screen 0\n[AVFoundation indev @ 0x1] AVFoundation audio devices:\n' +
    '[AVFoundation indev @ 0x1] [0] MacBook Pro Microphone\n[AVFoundation indev @ 0x1] [1] BlackHole 2ch\n';
  assert.deepStrictEqual(parseAvfoundationAudio(avf), [{ id: '0', label: 'MacBook Pro Microphone' }, { id: '1', label: 'BlackHole 2ch' }]);
  assert.deepStrictEqual(parsePactlSources(''), []);
  assert.deepStrictEqual(parseDshowAudio(null), []);
});

test('no audio device: still video only (-an), nothing mapped', () => {
  const args = buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'linux', env: {} });
  assert.ok(args.includes('-an') && !args.includes('-map') && !args.includes('-c:a'));
});

test('audio: Linux grab uses a second pulse input, maps both and encodes AAC', () => {
  const args = buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'linux', env: {}, audioDevice: '@DEFAULT_MONITOR@', audioBitrateKbps: 160 });
  const j = args.join(' ');
  assert.ok(j.includes('-i :0.0+1920,0 -thread_queue_size 1024 -f pulse -i @DEFAULT_MONITOR@'));
  assert.ok(j.includes('-map 0:v:0 -map 1:a:0 -c:a aac -b:a 160k -ar 48000 -ac 2'));
  assert.ok(!args.includes('-an'));
  assert.strictEqual(args[args.length - 1], base.ristUrl);
});

test('audio: Windows uses dshow and macOS shares one avfoundation input', () => {
  const win = buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'win32', env: {}, audioDevice: 'Stereo Mix (Realtek Audio)' });
  assert.ok(win.join(' ').includes('-i desktop -f dshow -i audio=Stereo Mix (Realtek Audio) -map 0:v:0 -map 1:a:0'));
  const mac = buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'darwin', env: {}, avfIndex: 1, audioDevice: '2', audioOffsetMs: 200 });
  assert.ok(mac.join(' ').includes('-capture_cursor 1 -i 1:2 -map 0:v:0 -map 0:a:0'));
  assert.ok(!mac.includes('-itsoffset'), 'a shared input cannot offset one track');
  // macOS browser capture has no shared input: audio is its own avfoundation input
  const macBrowser = buildFfmpegArgs({ ...base, backend: 'browser', platform: 'darwin', env: {}, audioDevice: '2' });
  assert.ok(macBrowser.join(' ').includes('-f avfoundation -i :2'));
});

test('audio: the browser backend puts the sound input first and copies H.264 untouched', () => {
  const args = buildFfmpegArgs({ ...base, backend: 'browser', passthrough: true, platform: 'linux', env: {}, audioDevice: '@DEFAULT_MONITOR@', audioOffsetMs: -100 });
  const j = args.join(' ');
  assert.ok(j.includes('-itsoffset -0.100 -thread_queue_size 1024 -f pulse -i @DEFAULT_MONITOR@ -fflags nobuffer -flags low_delay -f webm -i pipe:0'));
  assert.ok(j.includes('-map 1:v:0 -map 0:a:0 -c:a aac'));
  assert.ok(j.includes('-c:v copy') && !args.includes('-vf'));
  // Re-encoding browser capture works with sound too
  const reenc = buildFfmpegArgs({ ...base, backend: 'browser', platform: 'linux', env: {}, audioDevice: 'x.monitor' });
  assert.ok(reenc.includes('-vf') && reenc.join(' ').includes('-map 1:v:0 -map 0:a:0'));
});

test('audio: offsets are clamped, and device ids that could inject arguments are refused', () => {
  const j = buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'linux', env: {}, audioDevice: 'a.monitor', audioOffsetMs: 99999 }).join(' ');
  assert.ok(j.includes('-itsoffset 1.000'));
  assert.ok(!buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'linux', env: {}, audioDevice: 'a.monitor', audioOffsetMs: 0 }).includes('-itsoffset'));
  for (const [platform, device] of [['linux', 'a b'], ['linux', 'x;y'], ['linux', '-f'.repeat(120)], ['win32', 'video=Cam'], ['win32', 'a:b'],
    ['darwin', 'abc'], ['darwin', '1;2']]) {
    assert.throws(() => buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform, env: {}, avfIndex: 1, audioDevice: device }), undefined, `${platform}: ${device}`);
  }
  assert.strictEqual(buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'linux', env: {}, audioDevice: 'a.monitor', audioBitrateKbps: 1 }).join(' ').includes('-b:a 32k'), true);
});

test('resolveBitrate: the window value wins when numeric, clamped; otherwise Settings', () => {
  assert.strictEqual(resolveBitrate(8000, 6000), 8000);
  assert.strictEqual(resolveBitrate('4500', 6000), 4500);
  assert.strictEqual(resolveBitrate(8000.4, 6000), 8000);
  assert.strictEqual(resolveBitrate(5, 6000), 200);
  assert.strictEqual(resolveBitrate(10 ** 9, 6000), 100000);
  for (const bad of [undefined, null, '', 'fast', NaN]) assert.strictEqual(resolveBitrate(bad, 6000), 6000, String(bad));
  const args = buildFfmpegArgs({ ...base, backend: 'ffmpeg', platform: 'linux', env: {}, bitrateKbps: resolveBitrate(12000, 6000) });
  assert.ok(args.join(' ').includes('-b:v 12000k -maxrate 12000k -bufsize 12000k'));
});
