// plugins/screenstream/screenstream.js
//
// Control window for the Screen Stream plugin (screenstream.html). Talks to plugin.js through
// electronAPI.pluginTrigger('screenstream', ...). With the 'browser' backend it also does the capture:
// getDisplayMedia -> MediaRecorder (WebM) -> push-chunk -> ffmpeg stdin. With 'ffmpeg' the window is
// only a remote control. Only textContent is used for dynamic text.

const call = (name, data) => window.electronAPI.pluginTrigger('screenstream', name, data || {});
const $ = (id) => document.getElementById(id);

let info = null;
let mediaStream = null;
let recorder = null;
let chunkQueue = Promise.resolve();
const H264_TYPES = ['video/webm;codecs=h264', 'video/webm;codecs=avc1'];

function setBanner(text, warn) {
  $('banner').textContent = text;
  $('banner').className = warn ? 'banner warn' : 'banner';
}

function renderStatus(s) {
  const running = s.state === 'starting' || s.state === 'streaming';
  const names = { idle: 'Stopped', starting: 'Starting…', streaming: 'Streaming', error: 'Error' };
  $('state').textContent = names[s.state] || s.state;
  $('state').className = s.state;
  $('start-btn').style.display = running ? 'none' : '';
  $('peers-btn').style.display = running ? 'none' : '';
  $('stop-btn').style.display = running ? '' : 'none';
  $('screen-select').disabled = running;
  $('audio-select').disabled = running;
  $('bitrate-input').disabled = running;
  $('offset-input').disabled = running;
  $('message').textContent = s.message || '';
  $('log').textContent = (s.log || []).join('\n');
}

async function refreshStatus() {
  const res = await call('get-status');
  if (res && res.status) {
    renderStatus(res.status);
    // The stream ended on the main side (ffmpeg exited): release the capture.
    if (res.status.state !== 'streaming' && res.status.state !== 'starting') releaseCapture();
  }
}

function releaseCapture() {
  if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (_) {} }
  recorder = null;
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  mediaStream = null;
}

// Browser backend: the screen is captured first (so the codec is known), then ffmpeg is started to match.
async function startBrowser(mode) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: info.fps || 30 }, audio: false
  });
  const h264 = info.browserPassthrough ? H264_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) : null;
  const mimeType = h264 || ['video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const res = await call('start', { displayId: $('screen-select').value, passthrough: !!h264, mode, audioSource: $('audio-select').value, bitrateKbps: getBitrateKbps(), audioOffsetMs: getOffsetMs() });
  if (!res || !res.success) {
    stream.getTracks().forEach((t) => t.stop());
    return res;
  }
  mediaStream = stream;
  // H.264 goes to the network as recorded, so it gets the configured bitrate; VP8 is only an intermediate.
  const bps = h264 ? getBitrateKbps() * 1000 : 12000000;
  // Chromium picks its own keyframe interval otherwise, which can be 10 s or more; a receiver cannot show
  // anything until a keyframe arrives. Ignored by builds that do not know the option.
  const keyframe = h264 && info.browserKeyframeMs ? { videoKeyFrameIntervalDuration: info.browserKeyframeMs } : {};
  recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bps, ...keyframe });
  recorder.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    // Chunks must reach ffmpeg in order, so each waits for the previous one.
    chunkQueue = chunkQueue
      .then(() => e.data.arrayBuffer())
      .then((chunk) => call('push-chunk', { chunk }))
      .catch(() => {});
  };
  recorder.start(100);
  stream.getVideoTracks()[0].addEventListener('ended', () => stop());
  return res;
}

async function start(mode) {
  $('start-btn').disabled = true;
  $('peers-btn').disabled = true;
  $('message').textContent = '';
  try {
    let res;
    if (info.backend === 'browser') {
      try {
        res = await startBrowser(mode);
      } catch (err) {
        releaseCapture();
        await call('stop', { error: `Screen capture was not started${err && err.name ? ` (${err.name})` : ''}. If you cancelled the screen-share prompt, just start again.` });
        return;
      }
    } else {
      res = await call('start', { displayId: $('screen-select').value, mode, audioSource: $('audio-select').value, bitrateKbps: getBitrateKbps(), audioOffsetMs: getOffsetMs() });
    }
    if (!res || !res.success) $('message').textContent = (res && res.error) || 'Could not start the stream.';
  } finally {
    $('start-btn').disabled = false;
    $('peers-btn').disabled = false;
    refreshStatus();
  }
}

async function stop() {
  releaseCapture();
  await call('stop');
  refreshStatus();
}

// Diagnostic for the 'browser' backend: which codecs MediaRecorder offers on this system and what bitrate
// each really produces. Needs no ffmpeg or RIST destination. One getDisplayMedia call (one portal prompt)
// feeds every recording. Keep something moving on the captured screen, since a static desktop encodes tiny.
const TEST_SECONDS = 5;
const TEST_CODECS = [
  'video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm;codecs=av1',
  'video/webm;codecs=h264', 'video/webm;codecs=avc1', 'video/webm;codecs=avc1.42E01F',
  'video/webm;codecs=avc1.64001F', 'video/mp4;codecs=avc1.42E01F', 'video/x-matroska;codecs=avc1', 'video/webm'
];

function recordFor(stream, mimeType, bitsPerSecond, seconds) {
  return new Promise((resolve, reject) => {
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitsPerSecond });
    const t0 = performance.now();
    let bytes = 0;
    let chunks = 0;
    let firstChunkMs = null;
    let firstBytes = null;
    rec.ondataavailable = async (e) => {
      if (!e.data || !e.data.size) return;
      if (firstChunkMs === null) {
        firstChunkMs = performance.now() - t0;
        firstBytes = new Uint8Array(await e.data.slice(0, 64).arrayBuffer());
      }
      bytes += e.data.size;
      chunks += 1;
    };
    rec.onerror = (e) => reject(e.error || new Error('MediaRecorder error'));
    rec.onstop = () => {
      const secs = (performance.now() - t0) / 1000;
      resolve({ bytes, chunks, firstChunkMs, kbps: Math.round((bytes * 8) / secs / 1000), secs, firstBytes });
    };
    rec.start(100);
    setTimeout(() => rec.stop(), seconds * 1000);
  });
}

async function runCaptureTest() {
  const out = $('test-out');
  const btn = $('test-btn');
  const log = (line) => { out.textContent += line + '\n'; };
  out.textContent = '';
  btn.disabled = true;
  let stream = null;
  try {
    log(`Platform: ${info.platform}, UA: ${navigator.userAgent.match(/Electron\/[\d.]+|Chrome\/[\d.]+/g)?.join(' ')}`);
    const supported = TEST_CODECS.filter((t) => MediaRecorder.isTypeSupported(t));
    log('MediaRecorder supports:\n  ' + (supported.join('\n  ') || '(nothing)'));
    log('H.264 available: ' + (supported.some((t) => /h264|avc1/.test(t)) ? 'YES' : 'no'));
    if (!supported.length) return;

    log('\nAsking for the screen (answer the system prompt)...');
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: info.fps || 30 }, audio: false });
    const s = stream.getVideoTracks()[0].getSettings();
    log(`Capture: ${s.width}x${s.height} @ ${Math.round(s.frameRate || 0)} fps (requested ${info.fps || 30})`);
    const target = getBitrateKbps() * 1000;
    log(`Each recording: ${TEST_SECONDS}s, requested ${Math.round(target / 1000)} kbps. Keep the screen busy.\n`);

    for (const type of supported) {
      log(`Recording ${type} ...`);
      try {
        const r = await recordFor(stream, type, target, TEST_SECONDS);
        const hex = Array.from(r.firstBytes || []).slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
        log(`  ${r.kbps} kbps actual, ${(r.bytes / 1024).toFixed(0)} KiB, ${r.chunks} chunks, ` +
          `first chunk after ${Math.round(r.firstChunkMs)} ms, starts ${hex}`);
      } catch (err) {
        log(`  failed: ${err.message}`);
      }
    }
    log('\nDone. Copy this text (select it) and share it.');
  } catch (err) {
    log(`Test stopped: ${err.message}`);
  } finally {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    btn.disabled = false;
  }
}

// Sound sources the platform offers. The choice is remembered for next time (a per-viewer convenience).
async function loadAudioDevices() {
  const res = await call('get-audio-devices');
  const select = $('audio-select');
  for (const d of (res && res.devices) || []) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.label;
    select.appendChild(opt);
  }
  $('audio-hint').textContent = (res && res.hint) || '';
  try {
    const saved = localStorage.getItem('screenstream.audio');
    if (saved && [...select.options].some((o) => o.value === saved)) select.value = saved;
  } catch (_) { /* storage can be unavailable */ }
  select.addEventListener('change', () => {
    try { localStorage.setItem('screenstream.audio', select.value); } catch (_) { /* ignore */ }
  });
}

// The audio delay field starts from the Settings value, is remembered, and is only shown when sound is chosen.
function getOffsetMs() {
  const n = Math.round(Number($('offset-input').value));
  return Number.isFinite(n) ? Math.min(1000, Math.max(-1000, n)) : (info.audioOffsetMs || 0);
}

function initOffsetField() {
  const input = $('offset-input');
  input.value = String(info.audioOffsetMs || 0);
  try {
    const saved = localStorage.getItem('screenstream.audioOffset');
    if (saved !== null && Number.isFinite(Number(saved))) input.value = String(Math.round(Number(saved)));
  } catch (_) { /* storage can be unavailable */ }
  input.addEventListener('change', () => {
    input.value = String(getOffsetMs());
    try { localStorage.setItem('screenstream.audioOffset', input.value); } catch (_) { /* ignore */ }
  });
  const show = () => { $('offset-row').style.display = $('audio-select').value ? '' : 'none'; };
  $('audio-select').addEventListener('change', show);
  show();
}

// The bitrate field starts from the Settings value; the last value typed is remembered for next time.
function getBitrateKbps() {
  const n = Math.round(Number($('bitrate-input').value));
  return Number.isFinite(n) && n >= 200 ? Math.min(100000, n) : (info.bitrateKbps || 8000);
}

function initBitrateField() {
  const input = $('bitrate-input');
  input.value = String(info.bitrateKbps || 8000);
  try {
    const saved = Number(localStorage.getItem('screenstream.bitrate'));
    if (Number.isFinite(saved) && saved >= 200 && saved <= 100000) input.value = String(Math.round(saved));
  } catch (_) { /* storage can be unavailable */ }
  input.addEventListener('change', () => {
    input.value = String(getBitrateKbps());
    try { localStorage.setItem('screenstream.bitrate', input.value); } catch (_) { /* ignore */ }
  });
}

async function init() {
  info = await call('get-info');
  const select = $('screen-select');
  for (const d of info.displays) {
    const opt = document.createElement('option');
    opt.value = String(d.id);
    opt.textContent = d.label;
    if (d.primary) opt.selected = true;
    select.appendChild(opt);
  }
  try {
    const savedScreen = localStorage.getItem('screenstream.screen');
    if (savedScreen && [...select.options].some((o) => o.value === savedScreen)) select.value = savedScreen;
  } catch (_) { /* storage can be unavailable */ }
  select.addEventListener('change', () => {
    try { localStorage.setItem('screenstream.screen', select.value); } catch (_) { /* ignore */ }
  });
  await loadAudioDevices();
  initBitrateField();
  initOffsetField();
  $('dest').textContent = info.destination || 'not set (Settings → Screen Stream)';

  if (!info.ffmpeg) setBanner('ffmpeg was not found. Install it, or set its path in Settings.', true);
  else if (!info.ffmpeg.rist) setBanner('This ffmpeg build has no RIST support (it needs librist).', true);
  else if (!info.ffmpeg.encoder) setBanner('This ffmpeg build lacks the configured video encoder. Change it in Settings.', true);
  else if (!info.destination) setBanner('Set the destination IP address and port in Settings → Screen Stream to use Start Streaming. Stream Screen to Peers needs no destination.');
  else if (info.backend === 'browser') {
    setBanner('Wayland: the system will ask which screen to share when you start; the Screen list is ignored.');
  } else {
    setBanner('Sends the selected screen over RIST using ffmpeg. Change the destination in Settings.');
  }

  $('start-btn').addEventListener('click', () => start());
  $('peers-btn').addEventListener('click', () => start('peers'));
  $('stop-btn').addEventListener('click', stop);
  $('test-btn').addEventListener('click', runCaptureTest);
  refreshStatus();
  setInterval(refreshStatus, 1000);
}

init();
