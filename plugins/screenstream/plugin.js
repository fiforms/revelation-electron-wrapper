// plugins/screenstream/plugin.js
//
// Screen Stream: capture one screen and send it with ffmpeg over RIST (Reliable Internet Stream
// Transport) to a host:port set in Settings. Command building is in streamCommand.js (pure, tested);
// this file owns the ffmpeg child process, the capability probe and the control window.
//
// Hooks / manifest fields:
//   - main-process only (no clientHookJS), priority 95; control UI is screenstream.html, loaded from a
//     local file (not the Vite server) because getDisplayMedia needs a secure context
//   - adds "Plugins > Stream Screen (RIST)..." to the main menu and a sidebar button
//   - api (IPC plugin-trigger 'screenstream'): open-window, get-info, get-audio-devices, get-status, start, stop,
//     push-chunk
//     (start takes { displayId, mode: 'peers', audioSource, bitrateKbps, audioOffsetMs } ; see below)
//   - configTemplate / config keys: host, port, captureMethod (auto | ffmpeg | browser), fps, bitrateKbps,
//     scaleHeight, latencyMs, videoEncoder, captureCursor, browserPassthrough, encryption, secret (a passphrase,
//     marked secret: true), peerPort, peerEncryption, peerProbeMs, audioBitrateKbps, audioOffsetMs,
//     browserGopSeconds
//   - ffmpeg comes from lib/ffmpegResolver.js getActiveFfmpegPath (never assume a system install); the
//     build must include librist, which get-info reports
//   - app 'before-quit': stop the stream
//   - not in the default plugin list; the config has no credentials
//
// Stream Screen to Peers (peer protocol 2.1, doc/dev/PEERING.md "rist-screen"): the same capture/encode path,
// but ffmpeg is a RIST *listener* (rist://@0.0.0.0:peerPort, random per-session passphrase) and this plugin
// sends one 'rist-screen' start peer command (peerStream.js) so followers call in, and one stop when it ends.
// A stop ends whatever stream a follower is playing, whichever master started it. The follower half is the
// same plugin: register() adds a handler to AppContext.pluginPeerCommandHandlers; peerReceiver.js runs ffmpeg,
// remuxes to fMP4 (fmp4.js) and serves player.html/player.js on loopback; the window is the presentation window.
// The follower needs this plugin enabled. Config: peerPort, peerEncryption, peerProbeMs.
//
// Capture backends (see streamCommand.js): 'ffmpeg' grabs the screen directly (Windows gdigrab, macOS
// avfoundation, X11 x11grab). On Linux Wayland ffmpeg has no unprivileged grabber, so 'browser' captures in
// the control window (PipeWire portal) with MediaRecorder and pipes WebM chunks to ffmpeg via push-chunk.
// With browserPassthrough the window records H.264 (MediaRecorder, bitrate = bitrateKbps) and ffmpeg only
// remuxes it (-c:v copy); fps/scale/encoder settings then do not apply. The keyframe interval is Chromium's.
// The browser window uses its own session partition so its display-media handler cannot affect other windows.
// Gotchas: macOS needs Screen Recording permission; the macOS screen-index mapping assumes avfoundation lists
// the primary display first.

const { app, BrowserWindow, screen, desktopCapturer } = require('electron');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { getActiveFfmpegPath } = require(path.join(app.getAppPath(), 'lib', 'ffmpegResolver.js'));
const {
  resolveBackend, buildRistUrl, buildRistListenUrl, buildFfmpegArgs, parseAvfoundationScreens, toPhysicalRect,
  supportsRist, resolveEncryption, resolveBitrate, resolveAudioOffset, parsePactlSources, parseDshowAudio, parseAvfoundationAudio
} = require('./streamCommand');
const {
  COMMAND_TYPE, newStreamId, buildStartCommand, buildStopCommand, validateCommand, pickMasterHost
} = require('./peerStream');
const { createPeerReceiver } = require('./peerReceiver');

const DEFAULTS = {
  host: '', port: 5000, captureMethod: 'auto', fps: 30, bitrateKbps: 8000, scaleHeight: 0,
  latencyMs: 1000, videoEncoder: 'libx264', captureCursor: true, browserPassthrough: true,
  encryption: 'none', secret: '', peerPort: 5100, peerEncryption: '128', peerProbeMs: 8000,
  audioBitrateKbps: 128, audioOffsetMs: 0, browserGopSeconds: 5
};
const NATIVE_PROBE_MS = 7000; // ffmpeg-encoded streams use a 5 s keyframe interval; the probe window must exceed it
const MAX_PIPE_BACKLOG = 16 * 1024 * 1024;

let AppCtx = null;
let controlWindow = null;
let proc = null;
let pendingLaunch = null; // browser capture with audio: ffmpeg is spawned when the first video chunk arrives
let stopRequested = false;
let selectedDisplayId = null;
let status = idleStatus();
let peerStreamActive = false;
let receiver = null;
const capsCache = new Map();

function idleStatus(extra = {}) {
  return { state: 'idle', backend: null, message: '', destination: '', display: '', startedAt: 0, log: [], ...extra };
}

// " (AES-128)" for the status line; never includes the passphrase.
function encryptionLabel(cfg) {
  try {
    const aes = resolveEncryption(cfg.encryption, cfg.secret);
    return aes ? ` (AES-${aes})` : '';
  } catch (_) { return ''; }
}

function getConfig() {
  const cfg = { ...DEFAULTS, ...(screenstreamPlugin.config || {}) };
  for (const k of ['port', 'fps', 'bitrateKbps', 'scaleHeight', 'latencyMs', 'peerPort', 'peerProbeMs', 'audioBitrateKbps', 'audioOffsetMs', 'browserGopSeconds']) cfg[k] = Number(cfg[k]);
  for (const k of ['captureCursor', 'browserPassthrough']) cfg[k] = cfg[k] !== false && cfg[k] !== 'false';
  return cfg;
}

function run(cmd, args, timeoutMs = 10000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (_err, stdout, stderr) => resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

// What this ffmpeg build can do: RIST output and which video encoders exist. Cached per binary.
async function probeFfmpeg(ffmpegPath) {
  if (capsCache.has(ffmpegPath)) return capsCache.get(ffmpegPath);
  const [protocols, encoders, devices] = await Promise.all([
    run(ffmpegPath, ['-hide_banner', '-protocols']),
    run(ffmpegPath, ['-hide_banner', '-encoders']),
    run(ffmpegPath, ['-hide_banner', '-devices'])
  ]);
  const caps = {
    rist: supportsRist(protocols.stdout),
    encoders: new Set([...encoders.stdout.matchAll(/^\s*V\S*\s+(\w+)/gm)].map((m) => m[1])),
    // Device (input/output) names, e.g. pulse, dshow, avfoundation.
    devices: new Set([...devices.stdout.matchAll(/^\s[D ][E ]\s+(\S+)/gm)].flatMap((m) => m[1].split(',')))
  };
  if (protocols.stdout) capsCache.set(ffmpegPath, caps);
  return caps;
}

function listDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    primary: d.id === primaryId,
    label: `Screen ${i + 1}${d.id === primaryId ? ' (primary)' : ''} - ${d.size.width}x${d.size.height}`
  }));
}

async function findAvfoundationIndex(ffmpegPath, display) {
  const { stderr } = await run(ffmpegPath, ['-f', 'avfoundation', '-list_devices', 'true', '-i', '']);
  const screens = parseAvfoundationScreens(stderr);
  const primaryId = screen.getPrimaryDisplay().id;
  const ordered = screen.getAllDisplays().slice().sort((a, b) => (b.id === primaryId) - (a.id === primaryId));
  const pos = ordered.findIndex((d) => d.id === display.id);
  return screens[pos] ? screens[pos].index : undefined;
}

// Audio sources the user can pick: [{ id, label }] and a one-line hint about what "system sound" needs here.
async function listAudioDevices(ffmpegPath) {
  if (process.platform === 'win32') {
    const { stderr } = await run(ffmpegPath, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
    return { devices: parseDshowAudio(stderr), hint: 'Windows lists sound inputs only. To send desktop sound, enable "Stereo Mix" in the sound settings or install a virtual audio capturer.' };
  }
  if (process.platform === 'darwin') {
    const { stderr } = await run(ffmpegPath, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', '']);
    return { devices: parseAvfoundationAudio(stderr), hint: 'macOS cannot capture desktop sound by itself. Install a virtual audio device such as BlackHole, send the system output to it, and pick it here.' };
  }
  const caps = await probeFfmpeg(ffmpegPath);
  if (!caps.devices.has('pulse')) return { devices: [], hint: 'This ffmpeg build has no PulseAudio/PipeWire input.' };
  const { stdout } = await run('pactl', ['list', 'short', 'sources']);
  const devices = [{ id: '@DEFAULT_MONITOR@', label: 'System sound (default output)' }];
  for (const d of parsePactlSources(stdout)) if (!devices.some((x) => x.id === d.id)) devices.push(d);
  return { devices, hint: 'Pick "System sound" to send what the speakers play.' };
}

function updateStatus(patch) {
  status = { ...status, ...patch };
}

function endProcess() {
  proc = null;
  pendingLaunch = null;
  selectedDisplayId = null;
}

// ---- Master side of "Stream to Peers": one rist-screen start, one stop ----

function sendCommand(command) {
  const { sendPeerCommand } = require(path.join(app.getAppPath(), 'lib', 'peerCommandClient.js'));
  return sendPeerCommand(AppCtx, command);
}

// Rejects if peer commands cannot be sent (e.g. master mode is off).
async function sendPeerStart(params) {
  await sendCommand(buildStartCommand(params));
  peerStreamActive = true;
}

function sendPeerStop() {
  if (!peerStreamActive) return;
  peerStreamActive = false;
  sendCommand(buildStopCommand()).catch((err) => AppCtx.error(`[screenstream] Peer stop failed: ${err.message}`));
}

// ---- Follower side: play a master's stream in the presentation window ----

function presentationWindowModule() {
  return require(path.join(app.getAppPath(), 'lib', 'presentationWindow.js')).presentationWindow;
}

async function openPlayerWindow(url, onClosed) {
  const pw = presentationWindowModule();
  await pw.openWindow(AppCtx, url, null, true);
  const win = pw.presWindow;
  if (!win || win.isDestroyed()) throw new Error('The player window did not open.');
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    win.removeListener('closed', finish);
    if (!win.isDestroyed()) win.webContents.removeListener('did-navigate', onNavigate);
    onClosed();
  };
  // The master (or the user) replacing the window's content ends the stream.
  const onNavigate = (_event, navUrl) => { if (!navUrl.startsWith(base)) finish(); };
  win.on('closed', finish);
  win.webContents.on('did-navigate', onNavigate);
}

function closePlayerWindow(url) {
  const pw = presentationWindowModule();
  const win = pw.presWindow;
  if (!win || win.isDestroyed()) return;
  if (!win.webContents.getURL().startsWith(url.slice(0, url.lastIndexOf('/') + 1))) return;
  if (pw.shouldUseAlwaysOpenBehavior?.(AppCtx.config)) {
    pw.showDefaultOnMainPresentation(AppCtx).catch((err) => AppCtx.error(`[screenstream] ${err.message}`));
  } else {
    pw.closeWindow();
  }
}

function getReceiver() {
  if (!receiver) {
    receiver = createPeerReceiver({
      log: (m) => AppCtx.log(m),
      error: (m) => AppCtx.error(m),
      getFfmpegPath: () => getActiveFfmpegPath(AppCtx),
      openPlayerWindow,
      closePlayerWindow
    });
  }
  return receiver;
}

async function onRistScreenCommand(command, masterId) {
  let cmd;
  try { cmd = validateCommand(command); }
  catch (err) { AppCtx.error(`[screenstream] Ignoring rist-screen command from ${masterId}: ${err.message}`); return; }

  // Like close-presentation: ends whatever stream is playing here, whichever master started it.
  if (cmd.action === 'stop') {
    if (receiver) receiver.handleStop();
    return;
  }
  // Same switch that stops a master from opening presentation windows on this machine.
  if (AppCtx.config?.mainWindowOpenOnPeerPush === false) return;
  // A machine that is itself capturing must not play a stream (it could be its own screen).
  if (proc || pendingLaunch) return;
  if (receiver && receiver.activeStreamId() === cmd.streamId) return;

  const host = pickMasterHost(AppCtx.pairedPeerCache, AppCtx.config?.pairedMasters, masterId);
  if (!host) { AppCtx.error(`[screenstream] No address known for master ${masterId}; cannot receive its stream.`); return; }
  const ffmpegPath = getActiveFfmpegPath(AppCtx);
  if (!ffmpegPath) { AppCtx.error('[screenstream] Cannot receive a peer stream: ffmpeg was not found.'); return; }
  const caps = await probeFfmpeg(ffmpegPath);
  if (!caps.rist) { AppCtx.error('[screenstream] Cannot receive a peer stream: this ffmpeg build has no RIST support.'); return; }
  try {
    await getReceiver().handleStart({ ...cmd, host });
  } catch (err) {
    AppCtx.error(`[screenstream] Could not start the peer stream player: ${err.message}`);
  }
}

async function startStream(_event, data) {
  if (proc || pendingLaunch) return { success: false, error: 'A stream is already running.' };
  const cfg = getConfig();
  const ffmpegPath = getActiveFfmpegPath(AppCtx);
  if (!ffmpegPath) return { success: false, error: 'ffmpeg was not found. Install it or set its path in Settings.' };

  // 'peers': listen for followers (random per-session passphrase); otherwise send to host:port.
  const peers = data?.mode === 'peers';
  let ristUrl;
  let encryption = cfg.encryption;
  let secret = cfg.secret;
  try {
    if (peers) {
      ristUrl = buildRistListenUrl({ port: cfg.peerPort });
      encryption = String(cfg.peerEncryption || 'none');
      secret = encryption === 'none' ? '' : crypto.randomBytes(12).toString('base64url');
      resolveEncryption(encryption, secret);
    } else {
      ristUrl = buildRistUrl({ host: cfg.host, port: cfg.port });
    }
  } catch (err) { return { success: false, error: err.message }; }

  const caps = await probeFfmpeg(ffmpegPath);
  if (!caps.rist) {
    return { success: false, error: 'This ffmpeg build has no RIST support (it needs librist). Use a build that includes it.' };
  }
  const backend = resolveBackend(cfg.captureMethod, process.platform, process.env);
  const passthrough = backend === 'browser' && cfg.browserPassthrough && data?.passthrough === true;
  if (!passthrough && !caps.encoders.has(cfg.videoEncoder)) {
    return { success: false, error: `This ffmpeg build has no "${cfg.videoEncoder}" encoder. Change Video encoder in Settings.` };
  }

  // The renderer only names a source; it must be one the platform really lists.
  let audio = null;
  const wanted = String(data?.audioSource || '');
  if (wanted) {
    audio = (await listAudioDevices(ffmpegPath)).devices.find((d) => d.id === wanted) || null;
    if (!audio) return { success: false, error: 'That audio source is not available. Reopen the window to refresh the list.' };
  }

  // The window can override the Settings bitrate for this stream.
  const bitrateKbps = resolveBitrate(data?.bitrateKbps, cfg.bitrateKbps);

  const displays = screen.getAllDisplays();
  const display = displays.find((d) => d.id === Number(data?.displayId)) || screen.getPrimaryDisplay();

  let args;
  try {
    args = buildFfmpegArgs({
      backend,
      passthrough,
      platform: process.platform,
      env: process.env,
      rect: toPhysicalRect(display, process.platform === 'darwin' ? null : (w, r) => screen.dipToScreenRect(w, r)),
      avfIndex: backend === 'ffmpeg' && process.platform === 'darwin'
        ? await findAvfoundationIndex(ffmpegPath, display) : undefined,
      fps: cfg.fps,
      bitrateKbps,
      scaleHeight: cfg.scaleHeight,
      encoder: cfg.videoEncoder,
      cursor: cfg.captureCursor,
      latencyMs: cfg.latencyMs,
      audioDevice: audio ? audio.id : null,
      audioBitrateKbps: cfg.audioBitrateKbps,
      audioOffsetMs: resolveAudioOffset(data?.audioOffsetMs, cfg.audioOffsetMs),
      encryption,
      secret,
      ristUrl
    });
  } catch (err) {
    return { success: false, error: err.message };
  }

  stopRequested = false;
  selectedDisplayId = display.id;
  const launchCtx = { ffmpegPath, args, backend, peers, passthrough, cfg, encryption, secret, display, audio };
  status = idleStatus({
    state: backend === 'browser' ? 'starting' : 'streaming',
    backend,
    mode: peers ? 'peers' : 'rist',
    destination: peers
      ? `all peers, port ${cfg.peerPort}${encryptionLabel({ encryption, secret })}`
      : `${cfg.host}:${cfg.port}${encryptionLabel(cfg)}`,
    display: listDisplays().find((d) => d.id === display.id)?.label || '',
    audio: audio ? audio.label : '',
    startedAt: Date.now()
  });

  // With the browser backend and audio, ffmpeg opens the sound input first and the video pipe second, and its
  // sound starts the moment it is spawned. Spawning only when the first video chunk is in hand keeps that
  // start-up skew small and repeatable (measured: about +-20 ms between runs, audio roughly 150 ms early);
  // spawning earlier left audio hundreds of ms off, and the other input order over a second.
  if (backend === 'browser' && audio) {
    pendingLaunch = () => launchStream(launchCtx);
    return { success: true, backend, passthrough, mode: peers ? 'peers' : 'rist', deferred: true };
  }
  return launchStream(launchCtx);
}

// Spawns ffmpeg and, for peer streaming, sends the rist-screen start command.
async function launchStream(ctx) {
  const { ffmpegPath, args, backend, peers, passthrough, cfg, encryption, secret, audio } = ctx;
  AppCtx.log(`[screenstream] Starting (${backend} capture${audio ? ', with audio' : ''}) -> ${peers ? `peers, port ${cfg.peerPort}` : `${cfg.host}:${cfg.port}`}`);
  const child = spawn(ffmpegPath, args, {
    stdio: [backend === 'browser' ? 'pipe' : 'ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  proc = child;
  if (child.stdin) child.stdin.on('error', () => {});

  let pending = '';
  child.stderr.on('data', (buf) => {
    pending += buf.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop();
    const log = status.log.concat(lines.filter(Boolean)).slice(-30);
    updateStatus({ log });
  });
  child.on('error', (err) => {
    AppCtx.error(`[screenstream] ffmpeg failed to start: ${err.message}`);
    if (proc === child) endProcess();
    updateStatus({ state: 'error', message: `ffmpeg failed to start: ${err.message}` });
  });
  child.on('close', (code) => {
    if (proc !== child) return;
    endProcess();
    sendPeerStop();
    const last = status.log[status.log.length - 1] || '';
    if (status.state === 'error') { /* a stop with an error already set the message */ }
    else if (stopRequested || code === 0) updateStatus({ state: 'idle', message: '' });
    else updateStatus({ state: 'error', message: `ffmpeg stopped (exit ${code}). ${last}`.trim() });
    AppCtx.log(stopRequested ? '[screenstream] Stream stopped.' : `[screenstream] ffmpeg exited (${code})`);
  });

  if (peers) {
    try {
      await sendPeerStart({
        streamId: newStreamId(), port: cfg.peerPort, encryption, secret, latencyMs: cfg.latencyMs,
        probeMs: passthrough ? cfg.peerProbeMs : NATIVE_PROBE_MS, audio: !!audio
      });
    } catch (err) {
      const error = `Could not reach peers: ${err.message} Peer mode needs network mode and "publish this instance" enabled in Settings.`;
      stopStream(null, { error });
      return { success: false, error };
    }
  }

  return { success: true, backend, passthrough, mode: peers ? 'peers' : 'rist' };
}

function stopStream(_event, data) {
  sendPeerStop();
  const child = proc;
  if (!child && pendingLaunch) {
    pendingLaunch = null;
    updateStatus(data?.error ? { state: 'error', message: String(data.error) } : { state: 'idle', message: '' });
    return { success: true };
  }
  if (!child) {
    // A browser-capture failure arrives after ffmpeg is gone; keep its message visible.
    if (data?.error) updateStatus({ state: 'error', message: String(data.error) });
    return { success: true };
  }
  stopRequested = true;
  if (data?.error) updateStatus({ message: String(data.error) });
  try { child.stdin?.end(); } catch (_) {}
  child.kill('SIGTERM');
  const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 3000);
  child.once('close', () => clearTimeout(timer));
  if (data?.error) updateStatus({ state: 'error' });
  return { success: true };
}

function openControlWindow() {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.focus();
    return;
  }
  controlWindow = new BrowserWindow({
    width: 520,
    height: 760,
    title: 'Stream Screen (RIST)',
    parent: AppCtx.win || undefined,
    webPreferences: { preload: AppCtx.preload, partition: 'screenstream' }
  });
  controlWindow.setMenu(null);

  // Browser backend only: answer getDisplayMedia with the screen chosen in the window. On Wayland the
  // desktopCapturer call shows the system portal picker, and its answer wins.
  controlWindow.webContents.session.setDisplayMediaRequestHandler(async (_request, callback) => {
    // Answering with no video refuses the request: the page's getDisplayMedia rejects. Electron also throws
    // a TypeError from the callback in that case ("Video was requested, but no video stream was provided"),
    // which would otherwise escape this async handler as an unhandled rejection.
    const refuse = () => { try { callback({}); } catch (_) { /* expected, see above */ } };
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const source = sources.find((s) => String(s.display_id) === String(selectedDisplayId)) || sources[0];
      if (!source) return refuse();
      callback({ video: source });
    } catch (err) {
      // On Wayland this is what a cancelled or failed screen-share prompt looks like (often with no message).
      AppCtx.log(`[screenstream] No screen was shared (${(err && err.message) || err || 'the screen-share prompt was cancelled or failed'}).`);
      refuse();
    }
  });

  controlWindow.loadFile(path.join(__dirname, 'screenstream.html'));
  controlWindow.on('closed', () => {
    controlWindow = null;
    if (proc && status.backend === 'browser') stopStream();
  });
}

const screenstreamPlugin = {
  priority: 95,
  config: {},
  configTemplate: [
    {
      name: 'host', type: 'string', default: '',
      description: 'Destination IP address or host name that receives the RIST stream.'
    },
    {
      name: 'port', type: 'number', default: 5000,
      description: 'Destination RIST port (RIST uses this port and the next one; use an even number for the Simple profile).'
    },
    {
      name: 'captureMethod', type: 'string', default: 'auto', ui: 'dropdown',
      dropdownsrc: function () { return ['auto', 'ffmpeg', 'browser']; },
      description: 'Capture method. auto = ffmpeg grabs the screen, except on Linux Wayland where the system screen-share prompt is used.'
    },
    { name: 'fps', type: 'number', default: 30, description: 'Frames per second.' },
    { name: 'bitrateKbps', type: 'number', default: 8000, description: 'Default video bitrate in kilobits per second. The window has its own field, filled from this, for changing it per stream.' },
    { name: 'scaleHeight', type: 'number', default: 0, description: 'Scale the stream to this height in pixels (0 = keep the screen size).' },
    { name: 'latencyMs', type: 'number', default: 1000, description: 'RIST retransmission buffer in milliseconds (0 = ffmpeg default). Match the receiver.' },
    { name: 'videoEncoder', type: 'string', default: 'libx264', description: 'ffmpeg video encoder (libx264, h264_nvenc, h264_qsv, h264_videotoolbox…).' },
    { name: 'captureCursor', type: 'boolean', default: true, description: 'Include the mouse pointer in the stream.' },
    {
      name: 'encryption', type: 'string', default: 'none', ui: 'dropdown',
      dropdownsrc: function () { return ['none', '128', '256']; },
      description: 'RIST encryption: none, or AES-128 / AES-256 (bits). The receiver must use the same type and passphrase.'
    },
    {
      name: 'secret', type: 'string', default: '', secret: true,
      description: 'Encryption passphrase (used when Encryption is not none). Visible to other local users in the process list while streaming.'
    },
    {
      name: 'peerPort', type: 'number', default: 5100,
      description: 'Stream to Peers: the port this computer listens on for followers (also open the next port for inbound UDP).'
    },
    {
      name: 'peerEncryption', type: 'string', default: '128', ui: 'dropdown',
      dropdownsrc: function () { return ['none', '128', '256']; },
      description: 'Stream to Peers: encryption. A random passphrase is made for each stream and sent to followers over the peer channel.'
    },
    {
      name: 'peerProbeMs', type: 'number', default: 8000,
      description: 'Stream to Peers, Wayland passthrough only: how long followers analyze the stream before showing it. Must be longer than the keyframe interval, so lower values risk no picture; this is also the delay before a follower shows a picture.'
    },
    { name: 'audioBitrateKbps', type: 'number', default: 128, description: 'Audio bitrate in kilobits per second, when an audio source is chosen in the window (AAC).' },
    {
      name: 'audioOffsetMs', type: 'number', default: 0,
      description: 'Default lip-sync offset: delay the audio by this many milliseconds (negative makes it earlier). The window has its own field, filled from this, for changing it per stream. Mainly for Wayland capture, where video and sound are captured separately.'
    },
    {
      name: 'browserGopSeconds', type: 'number', default: 5,
      description: 'Wayland passthrough: ask the screen recorder for a keyframe at least this often (seconds; 0 = leave it to Chromium, which can be 10 s or more). Short intervals let receivers pick the stream up quickly; if sound is on and receivers show a black screen, the interval is longer than the receivers\' analysis time.'
    },
    {
      name: 'browserPassthrough', type: 'boolean', default: true,
      description: 'Wayland/browser capture only: have the screen recorder produce H.264 and send it as-is (lower CPU and delay). Off = re-encode with ffmpeg (uses the encoder and scale settings).'
    }
  ],
  pluginButtons: [{ title: 'Stream Screen (RIST)', action: 'open-window' }],

  // exposed for tests
  _internals: { getConfig },

  register(AppContext) {
    AppCtx = AppContext;
    AppContext.log('[screenstream] Registered');

    const pluginsMenu = AppContext.mainMenuTemplate.find((m) => m.label === 'Plugins');
    if (pluginsMenu && Array.isArray(pluginsMenu.submenu)) {
      pluginsMenu.submenu.push({ label: 'Stream Screen (RIST)...', click: () => openControlWindow() });
    }

    AppContext.pluginPeerCommandHandlers.set(COMMAND_TYPE, (command, masterId) => {
      onRistScreenCommand(command, masterId).catch((err) => AppContext.error(`[screenstream] ${err.message}`));
    });

    app.on('before-quit', () => {
      stopStream();
      if (receiver) receiver.stop();
    });
  },

  api: {
    'open-window': async function () {
      openControlWindow();
      return { success: true };
    },

    'get-info': async function () {
      const cfg = getConfig();
      const ffmpegPath = getActiveFfmpegPath(AppCtx);
      const caps = ffmpegPath ? await probeFfmpeg(ffmpegPath) : null;
      return {
        success: true,
        displays: listDisplays(),
        backend: resolveBackend(cfg.captureMethod, process.platform, process.env),
        platform: process.platform,
        destination: cfg.host ? `${cfg.host}:${cfg.port}${encryptionLabel(cfg)}` : '',
        ffmpeg: ffmpegPath ? { path: ffmpegPath, rist: caps.rist, encoder: caps.encoders.has(cfg.videoEncoder) } : null,
        fps: cfg.fps,
        bitrateKbps: cfg.bitrateKbps,
        audioOffsetMs: cfg.audioOffsetMs,
        browserPassthrough: cfg.browserPassthrough,
        browserKeyframeMs: Math.max(0, Math.round(cfg.browserGopSeconds * 1000)) || 0,
        peerPort: cfg.peerPort
      };
    },

    // [{ id, label }] of the sound sources the platform offers, plus a hint about capturing desktop sound.
    'get-audio-devices': async function () {
      const ffmpegPath = getActiveFfmpegPath(AppCtx);
      if (!ffmpegPath) return { success: true, devices: [], hint: 'ffmpeg was not found.' };
      return { success: true, ...(await listAudioDevices(ffmpegPath)) };
    },

    'get-status': async function () {
      return { success: true, status };
    },

    'start': startStream,
    'stop': async function (event, data) { return stopStream(event, data); },

    // Browser backend: one MediaRecorder chunk (ArrayBuffer) for ffmpeg's stdin.
    'push-chunk': async function (_event, data) {
      if (pendingLaunch && data?.chunk) {
        const go = pendingLaunch;
        pendingLaunch = null;
        await go();
      }
      const child = proc;
      if (!child || !child.stdin || !data?.chunk) return { success: false };
      if (status.state === 'starting') updateStatus({ state: 'streaming' });
      if (child.stdin.writableLength > MAX_PIPE_BACKLOG) return { success: false, dropped: true };
      child.stdin.write(Buffer.from(data.chunk));
      return { success: true };
    }
  }
};

module.exports = screenstreamPlugin;
