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
//   - api (IPC plugin-trigger 'screenstream'): open-window, get-info, get-status, start, stop, push-chunk
//   - configTemplate / config keys: host, port, captureMethod (auto | ffmpeg | browser), fps, bitrateKbps,
//     scaleHeight, latencyMs, videoEncoder, captureCursor
//   - ffmpeg comes from lib/ffmpegResolver.js getActiveFfmpegPath (never assume a system install); the
//     build must include librist, which get-info reports
//   - app 'before-quit': stop the stream
//   - not in the default plugin list; the config has no credentials
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
const { spawn, execFile } = require('child_process');
const { getActiveFfmpegPath } = require(path.join(__dirname, '..', '..', 'lib', 'ffmpegResolver.js'));
const {
  resolveBackend, buildRistUrl, buildFfmpegArgs, parseAvfoundationScreens, toPhysicalRect, supportsRist,
  resolveEncryption
} = require('./streamCommand');

const DEFAULTS = {
  host: '', port: 5000, captureMethod: 'auto', fps: 30, bitrateKbps: 6000, scaleHeight: 0,
  latencyMs: 1000, videoEncoder: 'libx264', captureCursor: true, browserPassthrough: true,
  encryption: 'none', secret: ''
};
const MAX_PIPE_BACKLOG = 16 * 1024 * 1024;

let AppCtx = null;
let controlWindow = null;
let proc = null;
let stopRequested = false;
let selectedDisplayId = null;
let status = idleStatus();
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
  for (const k of ['port', 'fps', 'bitrateKbps', 'scaleHeight', 'latencyMs']) cfg[k] = Number(cfg[k]);
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
  const [protocols, encoders] = await Promise.all([
    run(ffmpegPath, ['-hide_banner', '-protocols']),
    run(ffmpegPath, ['-hide_banner', '-encoders'])
  ]);
  const caps = {
    rist: supportsRist(protocols.stdout),
    encoders: new Set([...encoders.stdout.matchAll(/^\s*V\S*\s+(\w+)/gm)].map((m) => m[1]))
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

function updateStatus(patch) {
  status = { ...status, ...patch };
}

function endProcess() {
  proc = null;
  selectedDisplayId = null;
}

async function startStream(_event, data) {
  if (proc) return { success: false, error: 'A stream is already running.' };
  const cfg = getConfig();
  const ffmpegPath = getActiveFfmpegPath(AppCtx);
  if (!ffmpegPath) return { success: false, error: 'ffmpeg was not found. Install it or set its path in Settings.' };

  let ristUrl;
  try { ristUrl = buildRistUrl({ host: cfg.host, port: cfg.port }); }
  catch (err) { return { success: false, error: err.message }; }

  const caps = await probeFfmpeg(ffmpegPath);
  if (!caps.rist) {
    return { success: false, error: 'This ffmpeg build has no RIST support (it needs librist). Use a build that includes it.' };
  }
  const backend = resolveBackend(cfg.captureMethod, process.platform, process.env);
  const passthrough = backend === 'browser' && cfg.browserPassthrough && data?.passthrough === true;
  if (!passthrough && !caps.encoders.has(cfg.videoEncoder)) {
    return { success: false, error: `This ffmpeg build has no "${cfg.videoEncoder}" encoder. Change Video encoder in Settings.` };
  }

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
      bitrateKbps: cfg.bitrateKbps,
      scaleHeight: cfg.scaleHeight,
      encoder: cfg.videoEncoder,
      cursor: cfg.captureCursor,
      latencyMs: cfg.latencyMs,
      encryption: cfg.encryption,
      secret: cfg.secret,
      ristUrl
    });
  } catch (err) {
    return { success: false, error: err.message };
  }

  AppCtx.log(`[screenstream] Starting (${backend} capture) -> ${cfg.host}:${cfg.port}`);
  stopRequested = false;
  selectedDisplayId = display.id;
  const child = spawn(ffmpegPath, args, {
    stdio: [backend === 'browser' ? 'pipe' : 'ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  proc = child;
  if (child.stdin) child.stdin.on('error', () => {});
  status = idleStatus({
    state: backend === 'browser' ? 'starting' : 'streaming',
    backend,
    destination: `${cfg.host}:${cfg.port}${encryptionLabel(cfg)}`,
    display: listDisplays().find((d) => d.id === display.id)?.label || '',
    startedAt: Date.now()
  });

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
    const last = status.log[status.log.length - 1] || '';
    if (status.state === 'error') { /* a stop with an error already set the message */ }
    else if (stopRequested || code === 0) updateStatus({ state: 'idle', message: '' });
    else updateStatus({ state: 'error', message: `ffmpeg stopped (exit ${code}). ${last}`.trim() });
    AppCtx.log(`[screenstream] ffmpeg exited (${code})`);
  });

  return { success: true, backend, passthrough };
}

function stopStream(_event, data) {
  const child = proc;
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
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const source = sources.find((s) => String(s.display_id) === String(selectedDisplayId)) || sources[0];
      callback(source ? { video: source } : {});
    } catch (err) {
      AppCtx.error(`[screenstream] Screen capture source failed: ${err.message}`);
      callback({});
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
    { name: 'bitrateKbps', type: 'number', default: 6000, description: 'Video bitrate in kilobits per second.' },
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

    app.on('before-quit', () => { stopStream(); });
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
        browserPassthrough: cfg.browserPassthrough
      };
    },

    'get-status': async function () {
      return { success: true, status };
    },

    'start': startStream,
    'stop': async function (event, data) { return stopStream(event, data); },

    // Browser backend: one MediaRecorder chunk (ArrayBuffer) for ffmpeg's stdin.
    'push-chunk': async function (_event, data) {
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
