// Bounded HTTP(S) downloads for content the app fetches on a user's behalf (URL import, missing-media
// recovery, plugin media). Pure Node (no Electron), so tests can run it against a local server.
//
//   downloadToFile(url, dest, opts)  stream a body to disk; returns { size, sha1, head, path }.
//   fetchBuffer(url, opts)           read a small body into memory (manifests, JSON, SVG, HTML).
//
// Design points:
// - Media can be large (1-3 GB videos are normal), so file downloads are streamed to disk, hashed as
//   they arrive, and never held in memory. The per-file cap (DEFAULT_MAX_FILE_BYTES, 8 GiB, the same
//   figure as the .revel total limit) exists to stop an unbounded stream, not to limit real media.
//   Memory reads use a small cap (DEFAULT_MAX_BUFFER_BYTES).
// - The timeout is an idle timeout (no bytes for a while), not a total one, so a slow multi-GB download
//   still finishes but a stalled one does not hang forever.
// - A declared Content-Length over the cap is refused before any body is read; a body that grows past
//   the cap is aborted. Partial files are always removed.
// - Up to MAX_REDIRECTS redirects are followed; an https -> http downgrade is refused.
// - Files are created exclusively ('wx'), so an existing file or a pre-planted symlink is never written
//   through.
// Errors are DownloadError with a `code`: 'too-large', 'http-status', 'timeout', 'redirects',
// 'downgrade', 'protocol', 'incomplete', 'bad-url'.
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const MB = 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * MB;
const DEFAULT_MAX_BUFFER_BYTES = 32 * MB;
const DEFAULT_IDLE_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 5;
const HEAD_BYTES = 8; // matches revelFormat's signature sniffing

class DownloadError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
  }
}

// Resolves with the IncomingMessage of the final 200 response (redirects followed).
function openStream(url, opts, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new DownloadError(`Invalid URL: ${url}`, 'bad-url'));
      return;
    }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && !opts.httpsOnly)) {
      reject(new DownloadError(`Only ${opts.httpsOnly ? 'https' : 'http and https'} URLs are allowed: ${url}`, 'protocol'));
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    let activeRes = null; // once the body is streaming, request errors (e.g. the idle timeout) go to it

    const req = client.get(parsed, (res) => {
      activeRes = res;
      const status = res.statusCode || 0;

      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new DownloadError(`Too many redirects while downloading ${url}`, 'redirects'));
          return;
        }
        let next;
        try {
          next = new URL(res.headers.location, parsed);
        } catch {
          reject(new DownloadError(`Invalid redirect from ${url}`, 'bad-url'));
          return;
        }
        if (parsed.protocol === 'https:' && next.protocol === 'http:') {
          reject(new DownloadError(`Refusing redirect from https to http: ${url}`, 'downgrade'));
          return;
        }
        openStream(next.toString(), opts, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (status !== 200) {
        res.resume();
        reject(new DownloadError(`HTTP ${status} while downloading ${url}`, 'http-status'));
        return;
      }

      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > opts.maxBytes) {
        res.destroy();
        reject(new DownloadError(`${url} is ${declared} bytes, over the ${opts.maxBytes} byte limit`, 'too-large'));
        return;
      }
      resolve(res);
    });

    req.on('error', (err) => {
      if (activeRes && !activeRes.destroyed) activeRes.destroy(err);
      else reject(err);
    });
    req.setTimeout(opts.idleTimeoutMs, () => {
      req.destroy(new DownloadError(`Timed out (no data for ${opts.idleTimeoutMs} ms) while downloading ${url}`, 'timeout'));
    });
  });
}

function withDefaults(options, defaultMax) {
  return {
    maxBytes: Number.isFinite(options.maxBytes) ? options.maxBytes : defaultMax,
    idleTimeoutMs: Number.isFinite(options.idleTimeoutMs) ? options.idleTimeoutMs : DEFAULT_IDLE_TIMEOUT_MS,
    httpsOnly: !!options.httpsOnly
  };
}

// `dest` is a path, or a function (response) => path when the name depends on the response headers.
async function downloadToFile(url, dest, options = {}) {
  const opts = withDefaults(options, DEFAULT_MAX_FILE_BYTES);
  const res = await openStream(url, opts);
  const destPath = typeof dest === 'function' ? dest(res) : dest;

  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    let size = 0;
    let head = Buffer.alloc(0);
    let settled = false;
    let created = false; // only remove a file this call created (an EEXIST must not delete the existing one)
    const file = fs.createWriteStream(destPath, { flags: 'wx' });
    file.on('open', () => { created = true; });

    const fail = (err) => {
      if (settled) return;
      settled = true;
      res.destroy();
      file.destroy();
      if (created) fs.rm(destPath, { force: true }, () => reject(err));
      else reject(err);
    };

    file.on('error', fail);
    res.on('error', fail);
    res.on('close', () => {
      if (!res.complete) fail(new DownloadError(`Connection closed before the download finished: ${url}`, 'incomplete'));
    });
    res.on('data', (chunk) => {
      size += chunk.length;
      if (size > opts.maxBytes) {
        fail(new DownloadError(`${url} is larger than the ${opts.maxBytes} byte limit`, 'too-large'));
        return;
      }
      if (head.length < HEAD_BYTES) head = Buffer.concat([head, chunk.subarray(0, HEAD_BYTES - head.length)]);
      hash.update(chunk);
    });
    file.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve({ size, sha1: hash.digest('hex'), head, path: destPath });
    });
    res.pipe(file);
  });
}

async function fetchBuffer(url, options = {}) {
  const opts = withDefaults(options, DEFAULT_MAX_BUFFER_BYTES);
  const res = await openStream(url, opts);

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      res.destroy();
      reject(err);
    };
    res.on('error', fail);
    res.on('data', (chunk) => {
      size += chunk.length;
      if (size > opts.maxBytes) {
        fail(new DownloadError(`${url} is larger than the ${opts.maxBytes} byte limit`, 'too-large'));
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    res.on('close', () => {
      if (!res.complete) fail(new DownloadError(`Connection closed before the download finished: ${url}`, 'incomplete'));
    });
  });
}

module.exports = {
  DownloadError,
  downloadToFile,
  fetchBuffer,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_BUFFER_BYTES,
  DEFAULT_IDLE_TIMEOUT_MS,
  MAX_REDIRECTS
};
