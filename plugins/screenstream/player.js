// plugins/screenstream/player.js
//
// Plays the master's screen stream inside the follower's player window (player.html, served by
// peerReceiver.js). Reads the framed stream from ./stream (see peerReceiver.js for the framing) and plays it
// through Media Source Extensions with a hand-rolled low-latency policy: start near the live edge, nudge the
// playback rate (or seek, after a real stall) to stay there, and trim old buffer.
//
// Ported from slideannouncer's frontend/srtStreamPlayer.js, whose comments explain each constant. Changes: the
// WebSocket became a fetch stream, the debug overlay / server logging / late-join retries were dropped, and
// when the stream ends the whole pipeline restarts (a new ffmpeg means a new init segment and timeline).

const TARGET_LATENCY_SECONDS = 0.45;
const CATCHUP_ENGAGE_SECONDS = TARGET_LATENCY_SECONDS;
const CATCHUP_DISENGAGE_SECONDS = 0.3;
const LARGE_DRIFT_SECONDS = 1.3;
const CATCHUP_RATE = 1.02;
const RATE_STEP_PER_TICK = 0.005;
const CATCHUP_INTERVAL_MS = 250;
// Trailing buffer kept behind currentTime when trimming; removal never goes past the last keyframe.
const BUFFER_TRIM_KEEP_SECONDS = 5;
const RESTART_DELAY_MS = 1500;

const FRAME_INFO = 1;
const FRAME_INIT = 2;
const FRAME_FRAGMENT = 3;

const video = document.getElementById('video');
const statusEl = document.getElementById('status');

let abortController = null;
let mediaSource = null;
let sourceBuffer = null;
let appendQueue = [];
let catchupTimer = null;
let catchingUp = false;
let lastKeyframeTime = null;
let restartTimer = null;

function setStatus(text) {
  statusEl.textContent = text;
  statusEl.style.display = text ? '' : 'none';
}

function start() {
  stop();
  setStatus('Waiting for the screen stream…');
  video.preservesPitch = false;
  mediaSource = new MediaSource();
  video.src = URL.createObjectURL(mediaSource);
  mediaSource.addEventListener('sourceopen', () => readStream(), { once: true });
}

function stop() {
  if (abortController) abortController.abort();
  abortController = null;
  if (catchupTimer) clearInterval(catchupTimer);
  catchupTimer = null;
  clearTimeout(restartTimer);
  sourceBuffer = null;
  mediaSource = null;
  appendQueue = [];
  catchingUp = false;
  lastKeyframeTime = null;
  video.pause();
  video.removeAttribute('src');
  video.load();
}

function scheduleRestart(reason) {
  setStatus(reason);
  restartTimer = setTimeout(start, RESTART_DELAY_MS);
}

async function readStream() {
  abortController = new AbortController();
  const signal = abortController.signal;
  try {
    const res = await fetch('stream', { signal, cache: 'no-store' });
    if (!res.ok) return scheduleRestart('Stream unavailable, retrying…');
    const reader = res.body.getReader();
    let pending = new Uint8Array(0);
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const merged = new Uint8Array(pending.length + value.length);
      merged.set(pending);
      merged.set(value, pending.length);
      pending = merged;
      // Pull out every complete frame: [type u8][length u32 BE][payload].
      for (;;) {
        if (pending.length < 5) break;
        const len = new DataView(pending.buffer, pending.byteOffset).getUint32(1);
        if (pending.length < 5 + len) break;
        handleFrame(pending[0], pending.subarray(5, 5 + len));
        pending = pending.slice(5 + len);
      }
    }
    scheduleRestart('Stream ended, reconnecting…');
  } catch (err) {
    if (signal.aborted) return;
    scheduleRestart('Stream lost, reconnecting…');
  }
}

function handleFrame(type, payload) {
  if (type === FRAME_INFO) {
    initSourceBuffer(JSON.parse(new TextDecoder().decode(payload)).mime);
  } else if (type === FRAME_INIT) {
    enqueue(payload.slice().buffer);
  } else if (type === FRAME_FRAGMENT) {
    const t = new DataView(payload.buffer, payload.byteOffset).getFloat64(0);
    if (!Number.isNaN(t)) lastKeyframeTime = t;
    enqueue(payload.slice(8).buffer);
  }
}

function initSourceBuffer(mime) {
  if (sourceBuffer || !mediaSource) return;
  if (!MediaSource.isTypeSupported(mime)) {
    setStatus('This computer cannot play the stream format (' + mime + ').');
    return;
  }
  sourceBuffer = mediaSource.addSourceBuffer(mime);
  sourceBuffer.addEventListener('updateend', flushAppendQueue);
  flushAppendQueue();
}

function enqueue(buf) {
  appendQueue.push(buf);
  flushAppendQueue();
}

function flushAppendQueue() {
  if (!sourceBuffer || sourceBuffer.updating || appendQueue.length === 0) return;
  // Normally one fragment; several only after a stall. One merged append is cheaper than many.
  const buf = appendQueue.length === 1 ? appendQueue.shift() : mergeQueued();
  try {
    sourceBuffer.appendBuffer(buf);
  } catch (err) {
    setStatus('Playback error: ' + err.message);
    return;
  }
  maybeWarmUp();
}

function mergeQueued() {
  let total = 0;
  for (const b of appendQueue) total += b.byteLength;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const b of appendQueue) {
    merged.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }
  appendQueue = [];
  return merged;
}

function bufferedEnd() {
  return video.buffered.length ? video.buffered.end(video.buffered.length - 1) : null;
}

// Start (once) near the live edge instead of waiting for the browser's own VOD-style buffering.
function maybeWarmUp() {
  if (!video.paused) return;
  const end = bufferedEnd();
  if (end === null) return;
  video.currentTime = Math.max(0, end - TARGET_LATENCY_SECONDS);
  video.play().then(() => setStatus('')).catch(() => setStatus('Could not start playback.'));
  if (!catchupTimer) catchupTimer = setInterval(runCatchup, CATCHUP_INTERVAL_MS);
}

function runCatchup() {
  const buffered = video.buffered;
  if (!buffered.length) return;
  const end = buffered.end(buffered.length - 1);
  const gap = end - video.currentTime;
  if (gap > LARGE_DRIFT_SECONDS) {
    // A real stall: a visible skip beats a slow crawl back.
    video.currentTime = Math.max(0, end - TARGET_LATENCY_SECONDS);
    video.playbackRate = 1;
    catchingUp = false;
  } else {
    // Dead-band so ordinary jitter does not chatter the rate every tick.
    if (catchingUp) { if (gap < CATCHUP_DISENGAGE_SECONDS) catchingUp = false; }
    else if (gap > CATCHUP_ENGAGE_SECONDS) catchingUp = true;
    video.playbackRate = rampRate(video.playbackRate, catchingUp ? CATCHUP_RATE : 1);
  }
  trimBuffer(buffered);
}

function rampRate(current, target) {
  const delta = target - current;
  if (Math.abs(delta) <= RATE_STEP_PER_TICK) return target;
  return current + Math.sign(delta) * RATE_STEP_PER_TICK;
}

// Never remove past the last keyframe: fragments are not keyframe-aligned, and removing at an arbitrary time
// can wipe the whole buffered range.
function trimBuffer(buffered) {
  if (!sourceBuffer || sourceBuffer.updating || !buffered.length) return;
  const start = buffered.start(0);
  let removeEnd = video.currentTime - BUFFER_TRIM_KEEP_SECONDS;
  if (lastKeyframeTime !== null) removeEnd = Math.min(removeEnd, lastKeyframeTime);
  if (removeEnd > start) {
    try { sourceBuffer.remove(start, removeEnd); } catch (_) { /* skip this cycle */ }
  }
}

start();
