// plugins/screenstream/streamCommand.js
//
// Pure helpers that turn the Screen Stream settings into an ffmpeg command line. No Electron, no I/O,
// so tests/screenstream.test.js can cover every platform from one machine.
// Caller: plugin.js, peerStream.js. Exports: resolveBackend, buildRistUrl, buildRistListenUrl, buildFfmpegArgs, parseAvfoundationScreens, parsePactlSources,
// parseDshowAudio, parseAvfoundationAudio, resolveBitrate,
// toPhysicalRect, supportsRist, resolveEncryption.
//
// Two capture backends feed the same encoder/RIST output:
//   'ffmpeg'  - ffmpeg grabs the screen itself (gdigrab on Windows, avfoundation on macOS, x11grab on X11).
//   'browser' - a window captures through Electron/Chromium (the PipeWire portal on Wayland, where ffmpeg
//               has no unprivileged grabber) and pipes WebM into ffmpeg's stdin.
// Gotcha: ffmpeg's RIST protocol exists only when the build has librist, so callers must check
// supportsRist() on `ffmpeg -protocols` output instead of assuming it.

const ENCODER_RE = /^[a-z0-9_]+$/;
// A PulseAudio/PipeWire source name, or the special @DEFAULT_MONITOR@.
const AUDIO_ID_RE = /^[A-Za-z0-9@._:+-]{1,200}$/;
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const IPV6_RE = /^[0-9A-Fa-f:.]+$/;

/**
 * 'auto' picks 'browser' on Linux Wayland sessions and 'ffmpeg' everywhere else.
 */
function resolveBackend(setting, platform, env = {}) {
  if (setting === 'ffmpeg' || setting === 'browser') return setting;
  const wayland = env.XDG_SESSION_TYPE === 'wayland' || (!!env.WAYLAND_DISPLAY && !env.DISPLAY);
  return platform === 'linux' && wayland ? 'browser' : 'ffmpeg';
}

/**
 * Builds rist://host:port. Throws on a host or port that is not safe to put in a URL. An IPv6 literal is
 * bracketed. Protocol options go on the ffmpeg command line (-buffer_size), not in a query string, which
 * librist would parse as its own, different parameters.
 */
function buildRistUrl({ host, port }) {
  const h = String(host || '').trim().replace(/^\[|\]$/g, '');
  const p = Number(port);
  if (!h) throw new Error('Set the destination IP address in Settings → Screen Stream.');
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('The destination port must be 1-65535.');
  let hostPart;
  if (h.includes(':')) {
    if (!IPV6_RE.test(h)) throw new Error('The destination address is not valid.');
    hostPart = `[${h}]`;
  } else if (HOST_RE.test(h)) {
    hostPart = h;
  } else {
    throw new Error('The destination address is not valid.');
  }
  return `rist://${hostPart}:${p}`;
}

/**
 * rist://@0.0.0.0:port - the sender as a RIST *listener* that any number of receivers can call (peer
 * streaming). Needs the port and the one above it open for inbound UDP.
 */
function buildRistListenUrl({ port }) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('The peer stream port must be 1-65535.');
  return `rist://@0.0.0.0:${p}`;
}

/**
 * True when `ffmpeg -protocols` output lists a rist output protocol.
 */
function supportsRist(protocolsOutput) {
  return /^\s+rist\s*$/m.test(String(protocolsOutput || ''));
}

/**
 * Finds the "Capture screen N" entries in `ffmpeg -f avfoundation -list_devices true -i ""` output.
 * Returns [{ index, name }] in ffmpeg's order (the main display first).
 */
function parseAvfoundationScreens(stderr) {
  const screens = [];
  for (const line of String(stderr || '').split(/\r?\n/)) {
    const m = line.match(/\[(\d+)\]\s+(Capture screen \d+)/);
    if (m) screens.push({ index: Number(m[1]), name: m[2] });
  }
  return screens;
}

/**
 * Electron reports display bounds in DIPs; gdigrab and x11grab want device pixels. Uses Electron's
 * screen.dipToScreenRect when it is given, else multiplies by the display's scale factor.
 */
function toPhysicalRect(display, dipToScreenRect) {
  const b = display.bounds;
  let r;
  if (typeof dipToScreenRect === 'function') {
    try { r = dipToScreenRect(null, b); } catch (_) { r = null; }
  }
  if (!r) {
    const f = display.scaleFactor || 1;
    r = { x: b.x * f, y: b.y * f, width: b.width * f, height: b.height * f };
  }
  const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
  return { x: Math.round(r.x), y: Math.round(r.y), width: even(r.width), height: even(r.height) };
}

// ---- audio devices and inputs ----

/**
 * Lines of `pactl list short sources` (id, name, driver, format, state, tab separated) -> [{ id, label }].
 * Monitors (what a speaker is playing) are labelled as system sound and listed first.
 */
function parsePactlSources(stdout) {
  const monitors = [];
  const inputs = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const name = line.split('\t')[1];
    if (!name || !AUDIO_ID_RE.test(name)) continue;
    if (name.endsWith('.monitor')) monitors.push({ id: name, label: `System sound: ${name.replace(/\.monitor$/, '')}` });
    else inputs.push({ id: name, label: `Input: ${name}` });
  }
  return [...monitors, ...inputs];
}

/**
 * Audio devices from `ffmpeg -list_devices true -f dshow -i dummy` (stderr). Names containing ':' or '='
 * are skipped, because dshow would read them as the start of another device spec.
 */
function parseDshowAudio(stderr) {
  const out = [];
  for (const m of String(stderr || '').matchAll(/"([^"]+)"\s+\(audio\)/g)) {
    const name = m[1];
    if (/[:=]/.test(name) || /[\u0000-\u001f]/.test(name)) continue;
    if (!out.some((d) => d.id === name)) out.push({ id: name, label: name });
  }
  return out;
}

/**
 * Audio devices from `ffmpeg -f avfoundation -list_devices true -i ""` (stderr): the "[N] Name" lines under
 * "AVFoundation audio devices:". id is the device index as a string.
 */
function parseAvfoundationAudio(stderr) {
  const out = [];
  let inAudio = false;
  for (const line of String(stderr || '').split(/\r?\n/)) {
    if (/AVFoundation audio devices/i.test(line)) { inAudio = true; continue; }
    if (/AVFoundation video devices/i.test(line)) { inAudio = false; continue; }
    const m = inAudio && line.match(/\[(\d+)\]\s+(.+?)\s*$/);
    if (m) out.push({ id: m[1], label: m[2] });
  }
  return out;
}

// What a chosen audio device id may look like when it reaches a command line (the plugin also checks it
// against the live device list).
function checkAudioDevice(platform, device) {
  const d = String(device);
  if (platform === 'darwin') {
    if (!/^\d{1,3}$/.test(d)) throw new Error('The audio device is not valid.');
  } else if (platform === 'win32') {
    if (!d || d.length > 256 || /[\u0000-\u001f:=]/.test(d)) throw new Error('The audio device is not valid.');
  } else if (!AUDIO_ID_RE.test(d)) {
    throw new Error('The audio device is not valid.');
  }
  return d;
}

// A separate audio input (every case except ffmpeg-grab on macOS, which shares one avfoundation input).
// offsetMs > 0 delays the audio, < 0 advances it (-itsoffset).
function audioInputArgs({ platform, device, offsetMs }) {
  const d = checkAudioDevice(platform, device);
  const args = [];
  const offset = Math.max(-1000, Math.min(1000, Math.round(Number(offsetMs) || 0)));
  if (offset !== 0) args.push('-itsoffset', (offset / 1000).toFixed(3));
  if (platform === 'win32') return [...args, '-f', 'dshow', '-i', `audio=${d}`];
  if (platform === 'darwin') return [...args, '-f', 'avfoundation', '-i', `:${d}`];
  return [...args, '-thread_queue_size', '1024', '-f', 'pulse', '-i', d];
}

function captureInputArgs({ platform, rect, avfIndex, audioDevice, fps, cursor, env }) {
  const draw = cursor ? '1' : '0';
  if (platform === 'win32') {
    return ['-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', draw,
      '-offset_x', String(rect.x), '-offset_y', String(rect.y),
      '-video_size', `${rect.width}x${rect.height}`, '-i', 'desktop'];
  }
  if (platform === 'darwin') {
    if (!Number.isInteger(avfIndex)) throw new Error('No macOS screen-capture device was found.');
    const audio = audioDevice == null ? 'none' : checkAudioDevice('darwin', audioDevice);
    return ['-f', 'avfoundation', '-framerate', String(fps), '-capture_cursor', draw, '-i', `${avfIndex}:${audio}`];
  }
  const display = (env && env.DISPLAY) || ':0';
  return ['-f', 'x11grab', '-framerate', String(fps), '-draw_mouse', draw,
    '-video_size', `${rect.width}x${rect.height}`, '-i', `${display.split('.')[0]}.0+${rect.x},${rect.y}`];
}

/**
 * Full ffmpeg argument list (without the binary).
 *   backend      'ffmpeg' | 'browser'
 *   platform, env, rect, avfIndex   used by the 'ffmpeg' backend (see captureInputArgs)
 *   fps, bitrateKbps, scaleHeight (0 = native), encoder, cursor, latencyMs (0 = ffmpeg default), ristUrl
 *   encryption   'none' | '128' | '256' (RIST AES), with secret = the passphrase
 *   passthrough  'browser' only: the window already records H.264, so ffmpeg just copies it into MPEG-TS
 *                (fps, bitrate, scale and encoder are then the recorder's job, not ffmpeg's)
 *   audioDevice  optional device id (see the parse*Audio functions); adds an AAC track.
 *                audioBitrateKbps (default 128) and audioOffsetMs (+ delays the audio).
 *                Input order matters for sync: with the browser backend the audio input comes first, and the
 *                caller should spawn ffmpeg only when the first video chunk exists (see plugin.js).
 */
function buildFfmpegArgs(o) {
  const fps = Math.min(120, Math.max(1, Math.round(Number(o.fps) || 30)));
  const bitrate = Math.max(100, Math.round(Number(o.bitrateKbps) || 8000));
  const scaleHeight = Math.max(0, Math.round(Number(o.scaleHeight) || 0));
  const encoder = String(o.encoder || 'libx264').trim();
  const copy = o.backend === 'browser' && o.passthrough === true;
  if (!copy && !ENCODER_RE.test(encoder)) throw new Error('The video encoder name is not valid.');

  const hasAudio = o.audioDevice != null && o.audioDevice !== '';
  const audioKbps = Math.min(512, Math.max(32, Math.round(Number(o.audioBitrateKbps) || 128)));
  // macOS shares one avfoundation input for screen and sound, so it keeps them in sync by itself.
  const sharedInput = hasAudio && o.backend !== 'browser' && o.platform === 'darwin';
  const audioArgs = hasAudio ? audioInputArgs({ platform: o.platform, device: o.audioDevice, offsetMs: o.audioOffsetMs }) : [];

  const args = ['-hide_banner', '-nostdin', '-loglevel', 'warning'];
  let videoMap = null;
  let audioMap = null;
  if (o.backend === 'browser') {
    if (hasAudio) args.push(...audioArgs);
    args.push('-fflags', 'nobuffer', '-flags', 'low_delay', '-f', 'webm', '-i', 'pipe:0');
    if (hasAudio) { audioMap = '0:a:0'; videoMap = '1:v:0'; }
  } else {
    args.push(...captureInputArgs({ ...o, fps, cursor: o.cursor !== false, audioDevice: sharedInput ? o.audioDevice : null }));
    if (hasAudio && !sharedInput) args.push(...audioArgs);
    if (hasAudio) { videoMap = '0:v:0'; audioMap = sharedInput ? '0:a:0' : '1:a:0'; }
  }
  const audioOut = hasAudio
    ? ['-map', videoMap, '-map', audioMap, '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-ar', '48000', '-ac', '2']
    : ['-an'];

  if (copy) {
    args.push(...audioOut, '-c:v', 'copy', '-f', 'mpegts');
    return finishArgs(args, o);
  }

  // x264 and most hardware encoders need even dimensions.
  const filters = [];
  if (o.backend === 'browser') filters.push(`fps=${fps}`);
  filters.push(scaleHeight > 0 ? `scale=-2:${scaleHeight + (scaleHeight % 2)}` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
  args.push(...audioOut, '-vf', filters.join(','), '-c:v', encoder);
  if (encoder === 'libx264') args.push('-preset', 'veryfast', '-tune', 'zerolatency');
  args.push('-pix_fmt', 'yuv420p', '-g', String(fps * 5),
    '-b:v', `${bitrate}k`, '-maxrate', `${bitrate}k`, '-bufsize', `${bitrate}k`,
    '-f', 'mpegts');
  return finishArgs(args, o);
}

/**
 * The video bitrate (kbit/s) to use: the window's choice when it is a number, clamped to a sane range,
 * else the Settings value.
 */
function resolveBitrate(requested, fallback) {
  if (requested === null || requested === undefined || requested === '') return fallback;
  const n = Math.round(Number(requested));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100000, Math.max(200, n));
}

/**
 * The lip-sync offset (ms, positive delays the sound) to use: the window's choice when it is a number,
 * clamped to +-1000, else the Settings value.
 */
function resolveAudioOffset(requested, fallback) {
  if (requested === null || requested === undefined || requested === '') return fallback;
  const n = Math.round(Number(requested));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1000, Math.max(-1000, n));
}

/**
 * Normalizes the encryption settings: returns '' for none, else '128' or '256'. Throws when encryption is
 * on without a usable passphrase.
 */
function resolveEncryption(encryption, secret) {
  const mode = String(encryption == null ? 'none' : encryption).trim().toLowerCase();
  if (mode === '' || mode === 'none') return '';
  if (mode !== '128' && mode !== '256') throw new Error('Encryption must be none, 128 or 256.');
  const pass = String(secret || '');
  if (!pass) throw new Error('Set the encryption passphrase in Settings → Screen Stream (or turn encryption off).');
  if (pass.length > 127 || pass.includes('\0')) throw new Error('The encryption passphrase is not valid (max 127 characters).');
  return mode;
}

// Output options shared by both paths, then the destination. The passphrase is passed as an ffmpeg option
// (not a URL query) so it needs no URL-encoding. It is visible to other local users in the process list.
function finishArgs(args, o) {
  const latency = Math.round(Number(o.latencyMs));
  if (latency > 0) args.push('-buffer_size', String(Math.min(30000, latency)));
  const aes = resolveEncryption(o.encryption, o.secret);
  if (aes) args.push('-secret', String(o.secret), '-encryption', aes);
  args.push(o.ristUrl);
  return args;
}

module.exports = {
  resolveBackend,
  buildRistUrl,
  buildRistListenUrl,
  buildFfmpegArgs,
  resolveEncryption,
  resolveBitrate,
  resolveAudioOffset,
  parseAvfoundationScreens,
  parsePactlSources,
  parseDshowAudio,
  parseAvfoundationAudio,
  toPhysicalRect,
  supportsRist,
};
