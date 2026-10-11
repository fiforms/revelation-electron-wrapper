// plugins/screenstream/streamCommand.js
//
// Pure helpers that turn the Screen Stream settings into an ffmpeg command line. No Electron, no I/O,
// so tests/screenstream.test.js can cover every platform from one machine.
// Caller: plugin.js, peerStream.js. Exports: resolveBackend, buildRistUrl, buildRistListenUrl, buildFfmpegArgs, parseAvfoundationScreens,
// toPhysicalRect, supportsRist, resolveEncryption.
//
// Two capture backends feed the same encoder/RIST output:
//   'ffmpeg'  - ffmpeg grabs the screen itself (gdigrab on Windows, avfoundation on macOS, x11grab on X11).
//   'browser' - a window captures through Electron/Chromium (the PipeWire portal on Wayland, where ffmpeg
//               has no unprivileged grabber) and pipes WebM into ffmpeg's stdin.
// Gotcha: ffmpeg's RIST protocol exists only when the build has librist, so callers must check
// supportsRist() on `ffmpeg -protocols` output instead of assuming it.

const ENCODER_RE = /^[a-z0-9_]+$/;
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

function captureInputArgs({ platform, rect, avfIndex, fps, cursor, env }) {
  const draw = cursor ? '1' : '0';
  if (platform === 'win32') {
    return ['-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', draw,
      '-offset_x', String(rect.x), '-offset_y', String(rect.y),
      '-video_size', `${rect.width}x${rect.height}`, '-i', 'desktop'];
  }
  if (platform === 'darwin') {
    if (!Number.isInteger(avfIndex)) throw new Error('No macOS screen-capture device was found.');
    return ['-f', 'avfoundation', '-framerate', String(fps), '-capture_cursor', draw, '-i', `${avfIndex}:none`];
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
 */
function buildFfmpegArgs(o) {
  const fps = Math.min(120, Math.max(1, Math.round(Number(o.fps) || 30)));
  const bitrate = Math.max(100, Math.round(Number(o.bitrateKbps) || 6000));
  const scaleHeight = Math.max(0, Math.round(Number(o.scaleHeight) || 0));
  const encoder = String(o.encoder || 'libx264').trim();
  const copy = o.backend === 'browser' && o.passthrough === true;
  if (!copy && !ENCODER_RE.test(encoder)) throw new Error('The video encoder name is not valid.');

  const args = ['-hide_banner', '-nostdin', '-loglevel', 'warning'];
  if (o.backend === 'browser') {
    args.push('-fflags', 'nobuffer', '-flags', 'low_delay', '-f', 'webm', '-i', 'pipe:0');
  } else {
    args.push(...captureInputArgs({ ...o, fps, cursor: o.cursor !== false }));
  }

  if (copy) {
    args.push('-an', '-c:v', 'copy', '-f', 'mpegts');
    return finishArgs(args, o);
  }

  // x264 and most hardware encoders need even dimensions.
  const filters = [];
  if (o.backend === 'browser') filters.push(`fps=${fps}`);
  filters.push(scaleHeight > 0 ? `scale=-2:${scaleHeight + (scaleHeight % 2)}` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
  args.push('-an', '-vf', filters.join(','), '-c:v', encoder);
  if (encoder === 'libx264') args.push('-preset', 'veryfast', '-tune', 'zerolatency');
  args.push('-pix_fmt', 'yuv420p', '-g', String(fps * 2),
    '-b:v', `${bitrate}k`, '-maxrate', `${bitrate}k`, '-bufsize', `${bitrate}k`,
    '-f', 'mpegts');
  return finishArgs(args, o);
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
  parseAvfoundationScreens,
  toPhysicalRect,
  supportsRist,
};
