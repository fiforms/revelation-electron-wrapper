const http = require('http');
const https = require('https');
const { URL } = require('url');
const { generateChallenge, verifyChallenge } = require('./peerAuth');
const { saveConfig } = require('./configManager');

function pickPeerHost(peer) {
  const addresses = Array.isArray(peer.addresses) ? peer.addresses : [];
  const ipv4 = addresses.find((addr) => typeof addr === 'string' && addr.includes('.'));
  return ipv4 || peer.host;
}

function fetchJSON(url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method,
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
          try {
            const json = JSON.parse(data || '{}');
            if (res.statusCode >= 400) {
              return reject(new Error(json.error || `Request failed (${res.statusCode})`));
            }
            resolve(json);
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function pairWithPeer(AppContext, peer) {
  const host = pickPeerHost(peer);
  if (!host) {
    throw new Error('Peer host not available');
  }
  const pairingPort = peer.port || peer.txt?.pairingPort;
  if (!pairingPort) {
    throw new Error('Peer pairing port not available');
  }
  const baseUrl = `http://${host}:${pairingPort}`;
  const info = await fetchJSON(`${baseUrl}/peer/public-key`);

  const expectedHostname = peer.txt?.hostname;
  if (expectedHostname && info.hostname && expectedHostname !== info.hostname) {
    throw new Error(`Hostname mismatch: expected ${expectedHostname}, got ${info.hostname}`);
  }

  const masterId = info.instanceId || peer.instanceId || peer.txt?.instanceId;
  if (!masterId) {
    throw new Error('Master instance ID not available');
  }

  const existing = (AppContext.config.pairedMasters || []).find((item) => item.instanceId === masterId);
  const publicKeyToVerify = existing?.publicKey || info.publicKey;
  if (!publicKeyToVerify) {
    throw new Error('Master public key not available');
  }

  const challenge = generateChallenge();
  const challengeResp = await fetchJSON(`${baseUrl}/peer/challenge`, {
    method: 'POST',
    body: { challenge }
  });
  const signature = challengeResp.signature;
  if (!signature || !verifyChallenge(publicKeyToVerify, challenge, signature)) {
    throw new Error('Challenge verification failed');
  }

  const hostHint = peer.hostHint || existing?.hostHint;
  const pairingPortHint = peer.pairingPortHint || existing?.pairingPortHint;

  const updatedMaster = {
    instanceId: masterId,
    name: info.instanceName || peer.name,
    publicKey: publicKeyToVerify,
    pairedAt: new Date().toISOString(),
    hostHint,
    pairingPortHint
  };

  const masters = Array.isArray(AppContext.config.pairedMasters)
    ? [...AppContext.config.pairedMasters]
    : [];
  const existingIndex = masters.findIndex((item) => item.instanceId === masterId);
  if (existingIndex >= 0) {
    masters[existingIndex] = updatedMaster;
  } else {
    masters.push(updatedMaster);
  }

  AppContext.config.pairedMasters = masters;
  saveConfig(AppContext.config);

  if (!AppContext.pairedPeerCache) {
    AppContext.pairedPeerCache = new Map();
  }
  AppContext.pairedPeerCache.set(masterId, {
    host,
    port: pairingPort,
    addresses: peer.addresses || [],
    hostname: info.hostname || expectedHostname || null,
    lastSeen: new Date().toISOString()
  });

  return updatedMaster;
}

function unpairPeer(AppContext, master) {
  const instanceId = master?.instanceId;
  if (!instanceId) {
    throw new Error('Master instance ID not available');
  }

  const masters = Array.isArray(AppContext.config.pairedMasters)
    ? AppContext.config.pairedMasters
    : [];
  const nextMasters = masters.filter((item) => item.instanceId !== instanceId);
  const removed = nextMasters.length !== masters.length;

  if (removed) {
    AppContext.config.pairedMasters = nextMasters;
    saveConfig(AppContext.config);
  }

  if (AppContext.pairedPeerCache) {
    AppContext.pairedPeerCache.delete(instanceId);
  }

  return { instanceId, removed };
}

module.exports = {
  pairWithPeer,
  unpairPeer
};
