// plugins/screenstream/peerReceiver.js
//
// Follower side of "Stream Screen to Peers": receives the master's RIST stream with ffmpeg, remuxes it to
// fragmented MP4 and serves it to a local player page that plays it with Media Source Extensions.
// Caller: plugin.js (peer-command handler 'rist-screen'). Electron-free on purpose: the window is injected
// (openPlayerWindow / closePlayerWindow), so tests/screenstreamPeers.test.js runs the real ffmpeg + HTTP path.
//
// How it fits together:
//   handleStart -> start a loopback HTTP server (127.0.0.1, random port, random path token) and open the
//   player window on it. The player's GET <token>/stream is what starts ffmpeg, so every byte ffmpeg
//   produces goes to that one player and no late-join replay is needed. If the player reconnects, the old
//   ffmpeg is replaced.
//   Stream framing to the player: [type u8][length u32 BE][payload]. 1 = info JSON ({ mime }), 2 = init
//   segment, 3 = fragment (payload: f64 BE keyframe time, NaN if none, then the moof+mdat bytes).
//   Lifetime: the master sends `start` once and `stop` once, like open-presentation / close-presentation.
//   handleStop ends whatever stream is playing, whichever master started it. A stream with output that then
//   goes silent for idleTimeoutMs is killed so the player restarts it (and keeps retrying until the window
//   is closed or a stop arrives). Closing the window (onClosed) stops everything.
// Security: the server binds loopback only, serves a fixed file whitelist and the stream under an
// unguessable path, and sends a CSP with the player page.

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Fmp4Splitter } = require('./fmp4');
const { buildReceiveArgs } = require('./peerStream');

const FRAME_INFO = 1;
const FRAME_INIT = 2;
const FRAME_FRAGMENT = 3;
const STATIC_FILES = {
  'player.html': 'text/html; charset=utf-8',
  'player.js': 'text/javascript; charset=utf-8'
};
const PLAYER_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; media-src blob:";

function frame(type, payload) {
  const head = Buffer.alloc(5);
  head[0] = type;
  head.writeUInt32BE(payload.length, 1);
  return Buffer.concat([head, payload]);
}

function fragmentFrame(keyframeTime, data) {
  const t = Buffer.alloc(8);
  t.writeDoubleBE(keyframeTime == null ? NaN : keyframeTime, 0);
  return frame(FRAME_FRAGMENT, Buffer.concat([t, data]));
}

/**
 * @param {object} o
 * @param {(msg: string) => void} o.log
 * @param {(msg: string) => void} o.error
 * @param {() => string|null} o.getFfmpegPath
 * @param {(url: string, onClosed: () => void) => Promise<void>} o.openPlayerWindow
 * @param {(url: string) => void} o.closePlayerWindow
 * @param {string} [o.playerDir]  folder holding player.html / player.js
 * @param {number} [o.idleTimeoutMs]
 */
function createPeerReceiver(o) {
  const playerDir = o.playerDir || __dirname;
  const idleTimeoutMs = o.idleTimeoutMs || 10000;
  let current = null;

  function killFfmpeg(cur) {
    if (cur.idleTimer) clearInterval(cur.idleTimer);
    cur.idleTimer = null;
    const child = cur.ffmpeg;
    cur.ffmpeg = null;
    if (child) {
      child.removeAllListeners('close');
      try { child.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 2000).unref();
    }
    if (cur.client) {
      try { cur.client.end(); } catch (_) {}
      cur.client = null;
    }
  }

  function startFfmpeg(cur, res) {
    killFfmpeg(cur);
    const ffmpegPath = o.getFfmpegPath();
    if (!ffmpegPath) {
      o.error('[screenstream] Cannot receive the peer stream: ffmpeg was not found.');
      res.writeHead(503).end();
      return;
    }
    let args;
    try { args = buildReceiveArgs({ ...cur.params, host: cur.host }); }
    catch (err) { o.error(`[screenstream] Cannot receive the peer stream: ${err.message}`); res.writeHead(500).end(); return; }

    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
    cur.client = res;
    res.on('close', () => { if (cur.client === res) cur.client = null; });

    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    cur.ffmpeg = child;
    let lastOutput = 0;
    const send = (buf) => { lastOutput = Date.now(); if (cur.client === res) res.write(buf); };
    const splitter = new Fmp4Splitter({
      onInit: (init) => {
        if (!init.mime) {
          o.error('[screenstream] The peer stream is not H.264, which this receiver cannot play.');
          killFfmpeg(cur);
          return;
        }
        send(frame(FRAME_INFO, Buffer.from(JSON.stringify({ mime: init.mime }))));
        send(frame(FRAME_INIT, init.data));
      },
      onFragment: (f) => send(fragmentFrame(f.keyframeTime, f.data)),
      onError: (msg) => { o.error(`[screenstream] Peer stream: ${msg}`); killFfmpeg(cur); }
    });
    child.stdout.on('data', (d) => splitter.push(d));
    child.stderr.on('data', (d) => { cur.lastLog = String(d).trim().split('\n').pop(); });
    child.on('error', (err) => o.error(`[screenstream] ffmpeg failed to start: ${err.message}`));
    child.on('close', (code) => {
      if (cur.ffmpeg !== child) return;
      o.log(`[screenstream] Peer stream ffmpeg exited (${code}). ${cur.lastLog || ''}`.trim());
      cur.ffmpeg = null;
      if (cur.idleTimer) clearInterval(cur.idleTimer);
      cur.idleTimer = null;
      if (cur.client === res) { cur.client = null; res.end(); }
    });
    // Output that then stops means the sender went away; end it so the player restarts the stream.
    cur.idleTimer = setInterval(() => {
      if (lastOutput && Date.now() - lastOutput > idleTimeoutMs) {
        o.log('[screenstream] Peer stream went quiet; restarting.');
        killFfmpeg(cur);
      }
    }, 1000);
    cur.idleTimer.unref();
    o.log(`[screenstream] Receiving peer stream from ${cur.host}:${cur.params.port}`);
  }

  function serve(cur, req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const prefix = `/${cur.token}/`;
    if (req.method !== 'GET' || !url.pathname.startsWith(prefix)) return res.writeHead(404).end();
    const name = url.pathname.slice(prefix.length);
    if (name === 'stream') return startFfmpeg(cur, res);
    if (!Object.prototype.hasOwnProperty.call(STATIC_FILES, name)) return res.writeHead(404).end();
    fs.readFile(path.join(playerDir, name), (err, data) => {
      if (err) return res.writeHead(404).end();
      const headers = { 'Content-Type': STATIC_FILES[name], 'Cache-Control': 'no-store' };
      if (name === 'player.html') headers['Content-Security-Policy'] = PLAYER_CSP;
      res.writeHead(200, headers).end(data);
    });
  }

  function stopCurrent(closeWindow) {
    const cur = current;
    if (!cur) return;
    current = null;
    killFfmpeg(cur);
    try { cur.server.close(); } catch (_) {}
    if (cur.server.closeAllConnections) cur.server.closeAllConnections();
    if (closeWindow && cur.playerUrl) o.closePlayerWindow(cur.playerUrl);
    o.log('[screenstream] Peer stream stopped.');
  }

  return {
    /**
     * params: { streamId, host, port, encryption, secret, latencyMs, probeMs }. A `start` for the stream
     * already playing changes nothing; any other replaces it. Resolves to { url } once the player window
     * is opening.
     */
    async handleStart(params) {
      if (current && current.params.streamId === params.streamId) return { url: current.playerUrl };
      stopCurrent(true);
      const cur = {
        params, host: params.host, token: crypto.randomBytes(16).toString('hex'),
        ffmpeg: null, client: null, idleTimer: null, server: null, playerUrl: '', lastLog: ''
      };
      cur.server = http.createServer((req, res) => serve(cur, req, res));
      await new Promise((resolve, reject) => {
        cur.server.once('error', reject);
        cur.server.listen(0, '127.0.0.1', resolve);
      });
      current = cur;
      cur.playerUrl = `http://127.0.0.1:${cur.server.address().port}/${cur.token}/player.html`;
      try {
        await o.openPlayerWindow(cur.playerUrl, () => { if (current === cur) stopCurrent(false); });
      } catch (err) {
        if (current === cur) stopCurrent(false);
        throw err;
      }
      return { url: cur.playerUrl };
    },

    /** A `stop` ends whatever is playing, whichever master or stream it came from. */
    handleStop() { stopCurrent(true); },

    stop() { stopCurrent(true); },

    isActive() { return !!current; },
    activeStreamId() { return current ? current.params.streamId : null; }
  };
}

module.exports = { createPeerReceiver, FRAME_INFO, FRAME_INIT, FRAME_FRAGMENT };
