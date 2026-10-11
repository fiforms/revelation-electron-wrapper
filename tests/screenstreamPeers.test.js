// Screen Stream "Stream to Peers": the rist-screen command, the fragmented-MP4 parser (against a real
// ffmpeg-made fixture) and, when this machine's ffmpeg supports RIST + libx264, the real receiver path:
// a RIST listener sender, the receiver's ffmpeg + HTTP server, and the framed stream a player would read.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { Fmp4Splitter } = require('../plugins/screenstream/fmp4');
const { buildRistListenUrl } = require('../plugins/screenstream/streamCommand');
const {
  COMMAND_TYPE, buildStartCommand, buildStopCommand, validateCommand, pickMasterHost, buildReceiveArgs, newStreamId
} = require('../plugins/screenstream/peerStream');
const { createPeerReceiver } = require('../plugins/screenstream/peerReceiver');

const startPayload = { action: 'start', streamId: 'abcDEF123_-xyz', port: 5100, encryption: '128',
  secret: 'pass&w?rd#123 x', latencyMs: 300, probeMs: 3000, audio: false };

test('rist-screen command: build and validate round trip', () => {
  const cmd = buildStartCommand(startPayload);
  assert.strictEqual(cmd.type, COMMAND_TYPE);
  assert.deepStrictEqual(validateCommand(cmd), startPayload);
  // A stop names no stream: it ends whatever is playing, from whichever master.
  assert.deepStrictEqual(buildStopCommand(), { type: COMMAND_TYPE, payload: { action: 'stop' } });
  assert.deepStrictEqual(validateCommand(buildStopCommand()), { action: 'stop' });
  assert.deepStrictEqual(validateCommand({ type: COMMAND_TYPE, payload: { action: 'stop', streamId: 'whatever!' } }), { action: 'stop' });
  assert.match(newStreamId(), /^[A-Za-z0-9_-]{8,64}$/);
});

test('rist-screen command: rejects bad ids, ports, encryption and actions', () => {
  const bad = (payload) => assert.throws(() => validateCommand({ type: COMMAND_TYPE, payload }), undefined, JSON.stringify(payload));
  bad({ ...startPayload, streamId: 'short' });
  bad({ ...startPayload, streamId: 'has spaces here' });
  bad({ ...startPayload, port: 80 });
  bad({ ...startPayload, port: 70000 });
  bad({ ...startPayload, port: 'x' });
  bad({ ...startPayload, encryption: '64' });
  bad({ ...startPayload, secret: '' });
  bad({ ...startPayload, action: 'play' });
  assert.throws(() => validateCommand({ type: 'open-presentation', payload: {} }));
  assert.throws(() => validateCommand(null));
});

test('rist-screen command: clamps latency and probe, drops the secret when unencrypted', () => {
  const v = validateCommand({ type: COMMAND_TYPE, payload: { ...startPayload, encryption: 'none', secret: 'ignored', latencyMs: 999999, probeMs: 5 } });
  assert.strictEqual(v.encryption, '');
  assert.strictEqual(v.secret, '');
  assert.strictEqual(v.latencyMs, 30000);
  assert.strictEqual(v.probeMs, 1000);
});

test('the command has no host field and the receiver only uses the master address it already knows', () => {
  assert.ok(!('host' in buildStartCommand(startPayload).payload));
  const cache = new Map([['m1', { host: '10.0.0.7', port: 8000 }]]);
  assert.strictEqual(pickMasterHost(cache, [], 'm1'), '10.0.0.7');
  assert.strictEqual(pickMasterHost(new Map(), [{ instanceId: 'm2', hostHint: 'studio.local' }], 'm2'), 'studio.local');
  assert.strictEqual(pickMasterHost(new Map(), [], 'nobody'), '');
  assert.strictEqual(pickMasterHost(null, null, 'm1'), '');
});

test('receiver ffmpeg arguments: probe window, decryption before the input, fMP4 to stdout', () => {
  const v = validateCommand(buildStartCommand(startPayload));
  const args = buildReceiveArgs({ ...v, host: '10.0.0.7' });
  const joined = args.join(' ');
  assert.ok(joined.includes('-analyzeduration 3000000'));
  assert.ok(joined.includes('-buffer_size 300'));
  assert.deepStrictEqual(args.slice(args.indexOf('-secret'), args.indexOf('-secret') + 4), ['-secret', startPayload.secret, '-encryption', '128']);
  assert.ok(args.indexOf('-secret') < args.indexOf('-i'));
  assert.strictEqual(args[args.indexOf('-i') + 1], 'rist://10.0.0.7:5100');
  assert.ok(joined.endsWith('-i rist://10.0.0.7:5100 -map 0:v:0 -c:v copy -an -map_metadata -1 -movflags empty_moov+default_base_moof -frag_duration 100000 -f mp4 pipe:1'));
  assert.throws(() => buildReceiveArgs({ ...v, host: 'a/b' }));
  assert.ok(!buildReceiveArgs({ ...v, host: '10.0.0.7', encryption: '', secret: '' }).includes('-secret'));
});

test('sender listen URL', () => {
  assert.strictEqual(buildRistListenUrl({ port: 5100 }), 'rist://@0.0.0.0:5100');
  assert.throws(() => buildRistListenUrl({ port: 0 }));
});

test('rist-screen command: audio is an explicit boolean, off unless true', () => {
  assert.strictEqual(validateCommand(buildStartCommand({ ...startPayload, audio: true })).audio, true);
  assert.strictEqual(validateCommand(buildStartCommand({ ...startPayload, audio: undefined })).audio, false);
  assert.strictEqual(validateCommand({ type: COMMAND_TYPE, payload: { ...startPayload, audio: 'yes' } }).audio, false);
});

test('receiver ffmpeg arguments: sound is re-encoded to AAC only when announced', () => {
  const v = { ...validateCommand(buildStartCommand({ ...startPayload, audio: true })), host: '10.0.0.7' };
  const withAudio = buildReceiveArgs(v);
  assert.ok(withAudio.join(' ').includes('-map 0:v:0 -map 0:a:0? -c:v copy -c:a aac -b:a 128k -ar 48000 -ac 2 -map_metadata -1'));
  // Video is mandatory, sound optional (see buildReceiveArgs): no '?' on the video map.
  assert.ok(!withAudio.includes('0:v:0?'));
  assert.ok(!withAudio.includes('-an'));
  const without = buildReceiveArgs({ ...v, audio: false });
  assert.ok(without.includes('-an') && !without.includes('-c:a'));
});

// ---- fMP4 parser against a real ffmpeg-made file ----

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'screenstream-frag.mp4'));
const mfraSize = fixture.readUInt32BE(fixture.length - 4); // the mfra box ends with its own size

function splitFixture(chunkSize) {
  const data = fixture;
  const out = { init: null, fragments: [], errors: [] };
  const s = new Fmp4Splitter({ onInit: (i) => { out.init = i; }, onFragment: (f) => out.fragments.push(f), onError: (m) => out.errors.push(m) });
  for (let i = 0; i < data.length; i += chunkSize) s.push(data.subarray(i, i + chunkSize));
  out.total = data.length;
  return out;
}

test('fmp4 splitter: init info, fragments and keyframe times, whatever the chunking', () => {
  for (const chunkSize of [1, 7, 1000, 1 << 20]) {
    const r = splitFixture(chunkSize);
    assert.deepStrictEqual(r.errors, []);
    assert.match(r.init.mime, /^video\/mp4; codecs="avc1\.[0-9a-f]{6}"$/);
    assert.strictEqual(r.init.trackId, 1);
    assert.ok(r.init.timescale > 0);
    assert.ok(r.fragments.length >= 20, `fragments: ${r.fragments.length}`);
    // Everything but the trailing 'mfra' index that ffmpeg writes to a finished file (a live stream has none)
    // is accounted for as init or a whole fragment.
    const bytes = r.init.data.length + r.fragments.reduce((a, f) => a + f.data.length, 0);
    assert.strictEqual(r.total - bytes, mfraSize, `unaccounted bytes: ${r.total - bytes}`);
    const keys = r.fragments.filter((f) => f.keyframeTime !== null).map((f) => f.keyframeTime);
    // 3 s at -g 30 / 30 fps: keyframes at 0 s, 1 s and 2 s.
    assert.deepStrictEqual(keys.map((t) => Math.round(t)), [0, 1, 2]);
    assert.ok(keys.every((t, i) => i === 0 || t > keys[i - 1]));
  }
});

test('fmp4 splitter: reports a stream with no init segment', () => {
  const errors = [];
  const s = new Fmp4Splitter({ onInit() {}, onFragment() {}, onError: (m) => errors.push(m) });
  const moof = Buffer.alloc(16); moof.writeUInt32BE(16, 0); moof.write('moof', 4, 'latin1');
  s.push(moof);
  assert.strictEqual(errors.length, 1);
  s.push(moof);
  assert.strictEqual(errors.length, 1);
});

// ---- the real receiver path (needs ffmpeg with librist and libx264) ----

function ffmpegCanRun() {
  const protocols = spawnSync('ffmpeg', ['-hide_banner', '-protocols'], { encoding: 'utf8' });
  const encoders = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  return !protocols.error && /^\s+rist\s*$/m.test(protocols.stdout || '') && /libx264/.test(encoders.stdout || '');
}

function readFrames(url, wantFragments, timeoutMs) {
  return new Promise((resolve, reject) => {
    const frames = [];
    let pending = Buffer.alloc(0);
    const timer = setTimeout(() => { req.destroy(); reject(new Error(`timed out with ${frames.length} frames`)); }, timeoutMs);
    const req = http.get(url, (res) => {
      res.on('data', (d) => {
        pending = Buffer.concat([pending, d]);
        while (pending.length >= 5 && pending.length >= 5 + pending.readUInt32BE(1)) {
          const len = pending.readUInt32BE(1);
          frames.push({ type: pending[0], payload: pending.subarray(5, 5 + len) });
          pending = pending.subarray(5 + len);
        }
        if (frames.filter((f) => f.type === 3).length >= wantFragments) { clearTimeout(timer); req.destroy(); resolve(frames); }
      });
    });
    req.on('error', (err) => { if (!req.destroyed) { clearTimeout(timer); reject(err); } });
  });
}

test('receiver: real RIST listener -> ffmpeg -> framed stream a player can decode', { timeout: 60000 }, async (t) => {
  if (!ffmpegCanRun()) return t.skip('ffmpeg with RIST and libx264 is not available');
  const port = 20000 + 2 * Math.floor(Math.random() * 5000);
  const secret = 'pass&w?rd#123 x';
  const sender = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-re', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', '30', '-f', 'mpegts',
    '-buffer_size', '300', '-secret', secret, '-encryption', '128', buildRistListenUrl({ port })]);
  t.after(() => sender.kill('SIGKILL'));

  const events = [];
  const receiver = createPeerReceiver({
    log() {}, error(m) { events.push(`error: ${m}`); },
    getFfmpegPath: () => 'ffmpeg',
    openPlayerWindow: async (url) => { events.push(`open ${url}`); },
    closePlayerWindow: (url) => { events.push(`close ${url}`); },
    idleTimeoutMs: 60000
  });
  t.after(() => receiver.stop());

  await new Promise((r) => setTimeout(r, 800));
  const params = { streamId: 'testStream12345', host: '127.0.0.1', port, encryption: '128', secret, latencyMs: 300, probeMs: 2500 };
  const { url } = await receiver.handleStart(params);
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/player\.html$/);
  assert.strictEqual(events[0], `open ${url}`);

  // The page and script are served (with a CSP); a wrong token or path is not.
  const get = (u) => new Promise((resolve, reject) => http.get(u, (res) => {
    let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  }).on('error', reject));
  const page = await get(url);
  assert.strictEqual(page.status, 200);
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  assert.strictEqual((await get(url.replace('player.html', 'player.js'))).status, 200);
  assert.strictEqual((await get(url.replace('player.html', '../../etc/passwd'))).status, 404);
  assert.strictEqual((await get(url.replace(/\/[0-9a-f]{32}\//, '/' + '0'.repeat(32) + '/'))).status, 404);

  // A second start for the stream already playing changes nothing: no second window.
  await receiver.handleStart(params);
  assert.strictEqual(events.filter((e) => e.startsWith('open')).length, 1);

  const frames = await readFrames(url.replace('player.html', 'stream'), 12, 30000);
  assert.deepStrictEqual(frames.slice(0, 2).map((f) => f.type), [1, 2]);
  assert.match(JSON.parse(frames[0].payload.toString()).mime, /^video\/mp4; codecs="avc1\.[0-9a-f]{6}"$/);
  const fragments = frames.filter((f) => f.type === 3);
  assert.ok(fragments.some((f) => !Number.isNaN(f.payload.readDoubleBE(0))), 'a fragment should report a keyframe time');

  // What the player appends (init + fragments without the keyframe-time prefix) is a valid MP4.
  const file = path.join(os.tmpdir(), `screenstream-test-${process.pid}.mp4`);
  fs.writeFileSync(file, Buffer.concat([frames[1].payload, ...fragments.map((f) => f.payload.subarray(8))]));
  t.after(() => fs.rmSync(file, { force: true }));
  const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  assert.strictEqual(decode.status, 0, decode.stderr);

  // A stop ends the stream and closes the window and server, with no stream id involved.
  assert.ok(receiver.isActive());
  receiver.handleStop();
  assert.ok(!receiver.isActive());
  assert.strictEqual(events[events.length - 1], `close ${url}`);
  assert.deepStrictEqual(events.filter((e) => e.startsWith('error')), []);
});

test('receiver: closing the window stops the stream; any stop ends any stream; a new start replaces', async () => {
  const closedCallbacks = [];
  const closed = [];
  const receiver = createPeerReceiver({
    log() {}, error() {}, getFfmpegPath: () => null,
    openPlayerWindow: async (_url, onClosed) => { closedCallbacks.push(onClosed); },
    closePlayerWindow: (url) => closed.push(url)
  });
  const params = { streamId: 'closeTest123456', host: '127.0.0.1', port: 20000, encryption: '', secret: '', latencyMs: 0, probeMs: 2000 };

  await receiver.handleStart(params);
  assert.ok(receiver.isActive());
  closedCallbacks[0]();                       // the user (or a close-presentation) closed the window
  assert.ok(!receiver.isActive());
  assert.deepStrictEqual(closed, []);          // already closed: nothing for us to close

  await receiver.handleStart(params);          // an explicit new start plays again
  assert.ok(receiver.isActive());
  await receiver.handleStart({ ...params, streamId: 'secondStream1234' });
  assert.strictEqual(receiver.activeStreamId(), 'secondStream1234');
  assert.strictEqual(closed.length, 1);        // the first stream's window was closed for the replacement

  receiver.handleStop();                       // stops it though it came from a different "master"
  assert.ok(!receiver.isActive());
  assert.strictEqual(closed.length, 2);
  receiver.handleStop();                       // nothing playing: harmless
});

test('fmp4 splitter: a file with sound adds AAC to the codec string and still finds video keyframes', () => {
  const data = fs.readFileSync(path.join(__dirname, 'fixtures', 'screenstream-frag-audio.mp4'));
  const r = { init: null, fragments: [] };
  const sp = new Fmp4Splitter({ onInit: (i) => { r.init = i; }, onFragment: (f) => r.fragments.push(f), onError: (m) => assert.fail(m) });
  for (let i = 0; i < data.length; i += 333) sp.push(data.subarray(i, i + 333));
  assert.match(r.init.mime, /^video\/mp4; codecs="avc1\.[0-9a-f]{6},mp4a\.40\.2"$/);
  assert.strictEqual(r.init.timescale > 0, true);
  // The audio track must not be mistaken for the video one: keyframes are still 0 s, 1 s and 2 s.
  const keys = r.fragments.filter((f) => f.keyframeTime !== null).map((f) => Math.round(f.keyframeTime));
  assert.deepStrictEqual(keys, [0, 1, 2]);
});

test('receiver: real RIST listener with AAC sound -> framed stream with both tracks', { timeout: 60000 }, async (t) => {
  if (!ffmpegCanRun()) return t.skip('ffmpeg with RIST and libx264 is not available');
  const port = 20000 + 2 * Math.floor(Math.random() * 5000);
  const sender = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-re',
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=800:sample_rate=48000',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', '30',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-f', 'mpegts', buildRistListenUrl({ port })]);
  t.after(() => sender.kill('SIGKILL'));

  const receiver = createPeerReceiver({
    log() {}, error() {}, getFfmpegPath: () => 'ffmpeg',
    openPlayerWindow: async () => {}, closePlayerWindow() {}
  });
  t.after(() => receiver.stop());
  await new Promise((r) => setTimeout(r, 800));
  const { url } = await receiver.handleStart({ streamId: 'audioStream12345', host: '127.0.0.1', port, encryption: '', secret: '',
    latencyMs: 300, probeMs: 2500, audio: true });

  const frames = await readFrames(url.replace('player.html', 'stream'), 12, 30000);
  assert.match(JSON.parse(frames[0].payload.toString()).mime, /^video\/mp4; codecs="avc1\.[0-9a-f]{6},mp4a\.40\.2"$/);
  const fragments = frames.filter((f) => f.type === 3);
  const file = path.join(os.tmpdir(), `screenstream-audio-test-${process.pid}.mp4`);
  fs.writeFileSync(file, Buffer.concat([frames[1].payload, ...fragments.map((f) => f.payload.subarray(8))]));
  t.after(() => fs.rmSync(file, { force: true }));
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const kinds = probe.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  assert.ok(kinds.includes('h264,video') && kinds.includes('aac,audio'), probe.stdout + probe.stderr);
  const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  assert.strictEqual(decode.status, 0, decode.stderr);
});
