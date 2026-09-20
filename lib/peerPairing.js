const http = require('http');
const https = require('https');
const { URL } = require('url');
const { generateChallenge, verifyPeerChallenge } = require('./peerAuth');
const { saveConfig } = require('./configManager');

// Matches PEER_PROTOCOL_VERSION in revelation/vite.plugins.js.
const PEER_PROTOCOL_VERSION = 1;

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
  if (AppContext.config.mdnsBrowse === false) {
    throw new Error('Follower peering is disabled (mDNS Browse off).');
  }

  const host = pickPeerHost(peer);
  if (!host) {
    throw new Error('Peer host not available');
  }
  const pairingPin = peer?.pairingPin?.toString().trim();
  if (!pairingPin) {
    throw new Error('Pairing PIN is required');
  }
  const pairingPort = peer.port || peer.txt?.pairingPort;
  if (!pairingPort) {
    throw new Error('Peer pairing port not available');
  }
  const peerHttpsEnabled = peer.txt?.httpsEnabled === 'true';
  const protocol = peerHttpsEnabled ? 'https' : 'http';
  const baseUrl = `${protocol}://${host}:${pairingPort}`;
  const info = await fetchJSON(`${baseUrl}/peer/public-key`);

  const expectedHostname = peer.txt?.hostname;
  if (expectedHostname && info.hostname && expectedHostname !== info.hostname) {
    throw new Error(`Hostname mismatch: expected ${expectedHostname}, got ${info.hostname}`);
  }

  const masterId = info.instanceId || peer.instanceId || peer.txt?.instanceId;
  if (!masterId) {
    throw new Error('Master instance ID not available');
  }

  // A master that advertises no peer protocol version is running a build from
  // before the peer keypair was split out, and is still signing challenges with
  // the key that authenticates it to WordPress (SECURITY.md F2). Refuse rather
  // than fall back — falling back would keep the oracle reachable.
  if (Number(info.peerProtocol) !== PEER_PROTOCOL_VERSION) {
    throw new Error(
      `Master "${info.instanceName || peer.name || masterId}" is running an older, incompatible ` +
      'peering protocol. Update the app on the master and try again.'
    );
  }

  const existing = (AppContext.config.pairedMasters || []).find((item) => item.instanceId === masterId);
  // Pin to the peer key seen on a previous v1 pairing. Entries from before the
  // key split carry only the legacy `publicKey`, which is not a peer key — for
  // those we re-establish trust from this PIN-authenticated exchange.
  const publicKeyToVerify = existing?.peerPublicKey || info.publicKey;
  if (!publicKeyToVerify) {
    throw new Error('Master public key not available');
  }

  const challenge = generateChallenge();
  const challengeResp = await fetchJSON(`${baseUrl}/peer/challenge`, {
    method: 'POST',
    body: { challenge, pin: pairingPin }
  });
  const signature = challengeResp.signature;
  if (!signature || !verifyPeerChallenge(publicKeyToVerify, challenge, signature)) {
    throw new Error('Challenge verification failed');
  }

  const hostHint = peer.hostHint || existing?.hostHint;
  const pairingPortHint = peer.pairingPortHint || existing?.pairingPortHint;
  const httpsEnabled = peer.txt?.httpsEnabled === 'true';

  const updatedMaster = {
    instanceId: masterId,
    name: info.instanceName || peer.name,
    peerPublicKey: publicKeyToVerify,
    peerProtocol: PEER_PROTOCOL_VERSION,
    pairedAt: new Date().toISOString(),
    hostHint,
    pairingPortHint,
    httpsEnabled,
    pairingPin,
    natCompatibility: peer?.natCompatibility === true ? true : existing?.natCompatibility === true
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
