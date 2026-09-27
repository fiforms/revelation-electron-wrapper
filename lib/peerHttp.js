const http = require('http');
const https = require('https');
const { URL } = require('url');
const { signPeerFollowerAuth } = require('./peerAuth');

// Master responses that mean "this master no longer accepts this follower's
// key". Retrying cannot fix these — the user has to pair again.
const REVOKED_CODES = new Set(['not-paired', 'invalid-signature']);

// Rejected errors carry `status` (HTTP status) and `code` (the master's
// machine-readable error code, when it sent one).
function fetchJSON(url, { method = 'GET', body, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        timeout: timeoutMs,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          : undefined
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(data || '{}');
          } catch (err) {
            if (res.statusCode >= 400) {
              const httpErr = new Error(`Request failed (${res.statusCode})`);
              httpErr.status = res.statusCode;
              return reject(httpErr);
            }
            return reject(err);
          }
          if (res.statusCode >= 400) {
            const httpErr = new Error(json.error || `Request failed (${res.statusCode})`);
            httpErr.status = res.statusCode;
            httpErr.code = typeof json.code === 'string' ? json.code : undefined;
            httpErr.body = json;
            return reject(httpErr);
          }
          resolve(json);
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// POST to a master endpoint as an enrolled follower: fetch a fresh nonce, sign
// it with this instance's peer key, send. `extra` is bound into the signature
// (e.g. the challenge for /peer/challenge).
async function followerRequest(AppContext, baseUrl, masterId, endpoint, purpose, { extra = '', body = {} } = {}) {
  const followerId = AppContext.config.mdnsInstanceId;
  const privateKey = AppContext.config.peerRsaPrivateKey;
  if (!followerId || !privateKey) {
    throw new Error('This device has no peer identity yet (restart the app).');
  }
  const { nonce } = await fetchJSON(`${baseUrl}/peer/auth-nonce`);
  if (!nonce) throw new Error('Master did not issue an auth nonce.');
  const signature = signPeerFollowerAuth(privateKey, { purpose, masterId, followerId, nonce, extra });
  return fetchJSON(`${baseUrl}${endpoint}`, {
    method: 'POST',
    body: { ...body, followerInstanceId: followerId, nonce, signature }
  });
}

function isPairingRevokedError(err) {
  return REVOKED_CODES.has(err?.code);
}

module.exports = { fetchJSON, followerRequest, isPairingRevokedError };
