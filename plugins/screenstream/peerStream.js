// plugins/screenstream/peerStream.js
//
// "Stream Screen to Peers": the wire command and the follower's ffmpeg command line. Pure (no Electron, no
// I/O); covered by tests/screenstreamPeers.test.js. Callers: plugin.js (master sends, follower handles),
// peerReceiver.js. Exports: COMMAND_TYPE, newStreamId, buildStartCommand, buildStopCommand, validateCommand,
// pickMasterHost, buildReceiveArgs.
//
// Wire format (peer protocol 2.1, additive; see doc/dev/PEERING.md "rist-screen"): one `peer-command` of type
// 'rist-screen' with payload { action: 'start' | 'stop', streamId, ... }.
//   start: { streamId, port, encryption: 'none'|'128'|'256', secret, latencyMs, probeMs, audio }. Sent once, when
//          the master starts streaming (so, like open-presentation, a follower that connects later misses it).
//   stop:  {}. Sent once. A follower stops whatever stream it is playing, whichever master started it.
// The payload never carries a host: the follower connects to the address it already has for the master, so a
// command cannot point a follower at an arbitrary machine. The master is the RIST *listener*; followers call it.
// Gotcha: ffmpeg does not stop probing at the first keyframe. It waits out -analyzeduration, and if that is
// shorter than the sender's keyframe interval it never produces an init segment, so `probeMs` (set by the
// sender, which knows its keyframe interval) must exceed the keyframe interval.

const crypto = require('crypto');
const { buildRistUrl, resolveEncryption } = require('./streamCommand');

const COMMAND_TYPE = 'rist-screen';
const STREAM_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MIN_PORT = 1024;

function newStreamId() {
  return crypto.randomBytes(9).toString('base64url');
}

function buildStartCommand({ streamId, port, encryption, secret, latencyMs, probeMs, audio }) {
  return {
    type: COMMAND_TYPE,
    payload: {
      action: 'start', streamId, port, encryption: encryption || 'none', secret: secret || '', latencyMs, probeMs,
      audio: audio === true
    }
  };
}

function buildStopCommand() {
  return { type: COMMAND_TYPE, payload: { action: 'stop' } };
}

function inRange(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/**
 * Checks a received command (it comes from a paired master, but is still validated) and returns normalized
 * { action: 'stop' } or { action: 'start', streamId, port, encryption, secret, latencyMs, probeMs, audio }. Throws
 * with a message when invalid.
 */
function validateCommand(command) {
  if (!command || command.type !== COMMAND_TYPE) throw new Error('Not a rist-screen command.');
  const p = command.payload || {};
  if (p.action === 'stop') return { action: 'stop' };
  if (p.action !== 'start') throw new Error('Unknown rist-screen action.');
  const streamId = String(p.streamId || '');
  if (!STREAM_ID_RE.test(streamId)) throw new Error('Invalid stream id.');
  const port = Number(p.port);
  if (!Number.isInteger(port) || port < MIN_PORT || port > 65535) throw new Error('Invalid stream port.');
  const encryption = resolveEncryption(p.encryption, p.secret);
  return {
    action: 'start',
    streamId,
    port,
    encryption,
    secret: encryption ? String(p.secret) : '',
    latencyMs: inRange(p.latencyMs, 0, 30000, 0),
    probeMs: inRange(p.probeMs, 1000, 20000, 8000),
    audio: p.audio === true
  };
}

/**
 * The master's address as this follower already knows it: the live mDNS entry, else the pairing's host hint.
 * `cache` is AppContext.pairedPeerCache (Map), `masters` is config.pairedMasters. Returns '' when unknown.
 */
function pickMasterHost(cache, masters, masterId) {
  const cached = cache && typeof cache.get === 'function' ? cache.get(masterId) : null;
  if (cached && cached.host) return String(cached.host);
  const paired = (Array.isArray(masters) ? masters : []).find((m) => m && m.instanceId === masterId);
  return paired && paired.hostHint ? String(paired.hostHint) : '';
}

/**
 * ffmpeg arguments (without the binary) that call the master's RIST listener and remux the H.264 to
 * fragmented MP4 on stdout, as slideannouncer's bridge does: no decode or re-encode, fragments cut by
 * duration (not at keyframes); sound only when the start command says so.
 */
function buildReceiveArgs({ host, port, encryption, secret, latencyMs, probeMs, audio }) {
  const url = buildRistUrl({ host, port });
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'warning', '-nostats',
    '-fflags', 'nobuffer', '-flags', 'low_delay',
    '-analyzeduration', String(Math.round(probeMs) * 1000), '-probesize', '20000000'];
  if (latencyMs > 0) args.push('-buffer_size', String(Math.round(latencyMs)));
  const aes = resolveEncryption(encryption, secret);
  if (aes) args.push('-secret', String(secret), '-encryption', aes);
  // Sound is re-encoded (cheap), not copied: copying the sender's ADTS AAC into fMP4 was rejected by Chromium's
  // MSE in slideannouncer's bridge, which is why it re-encodes too.
  // The maps make the video mandatory and the sound optional. Without them, when probing ends before the
  // sender's first keyframe (unknown video parameters) ffmpeg drops the video and carries on with sound only:
  // an init segment with no video track, and a black screen that never recovers. With them it exits instead,
  // and the caller retries, which is what already happens for a video-only stream.
  args.push('-i', url, '-map', '0:v:0', ...(audio === true ? ['-map', '0:a:0?'] : []),
    '-c:v', 'copy', ...(audio === true ? ['-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2'] : ['-an']), '-map_metadata', '-1',
    '-movflags', 'empty_moov+default_base_moof', '-frag_duration', '100000', '-f', 'mp4', 'pipe:1');
  return args;
}

module.exports = {
  COMMAND_TYPE,
  newStreamId,
  buildStartCommand,
  buildStopCommand,
  validateCommand,
  pickMasterHost,
  buildReceiveArgs,
};
