const { BrowserWindow } = require('electron');
const { PEER_PROTOCOL_VERSION, generateChallenge, verifyPeerChallenge } = require('./peerAuth');
const { fetchJSON } = require('./peerHttp');
const { saveConfig } = require('./configManager');

function pickPeerHost(peer) {
  const addresses = Array.isArray(peer.addresses) ? peer.addresses : [];
  const ipv4 = addresses.find((addr) => typeof addr === 'string' && addr.includes('.'));
  return ipv4 || peer.host;
}

// Tell open windows (Settings → Peer Pairing) that pairing state changed.
function notifyPairingsChanged() {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('peer-pairings-updated');
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

  // Only v2 masters accept follower-key enrollment. Masters advertising no
  // version still sign with their WordPress key (revelation/doc/SECURITY.md F2)
  // and v1 masters expect the PIN on every connection; refuse both.
  if (Number(info.peerProtocol) !== PEER_PROTOCOL_VERSION) {
    throw new Error(
      `Master "${info.instanceName || peer.name || masterId}" is running an older, incompatible ` +
      'peering protocol. Update the app on the master and try again.'
    );
  }

  const existing = (AppContext.config.pairedMasters || []).find((item) => item.instanceId === masterId);
  // Pin to the peer key seen on a previous pairing. Entries from before the
  // key split carry only the legacy `publicKey`, which is not a peer key — for
  // those we re-establish trust from this PIN-authenticated exchange.
  const publicKeyToVerify = existing?.peerPublicKey || info.publicKey;
  if (!publicKeyToVerify) {
    throw new Error('Master public key not available');
  }

  const followerPublicKey = AppContext.config.peerRsaPublicKey;
  if (!AppContext.config.mdnsInstanceId || !followerPublicKey) {
    throw new Error('This device has no peer identity yet (restart the app).');
  }

  // Enrollment: the PIN is sent this once, together with this device's peer
  // public key. From here on the master recognises the key, not the PIN, so
  // the PIN is not stored.
  const challenge = generateChallenge();
  const pairResp = await fetchJSON(`${baseUrl}/peer/pair`, {
    method: 'POST',
    body: {
      pin: pairingPin,
      challenge,
      followerInstanceId: AppContext.config.mdnsInstanceId,
      followerName: String(AppContext.config.mdnsInstanceName || '').trim(),
      followerPublicKey
    }
  });
  const signature = pairResp.signature;
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

  notifyPairingsChanged();
  return updatedMaster;
}

// Pair again with a master already in pairedMasters (after it forgot this
// device, or after an upgrade from an older pairing), reusing what we know
// about where it is.
async function repairPeer(AppContext, { instanceId, pairingPin } = {}) {
  const master = (AppContext.config.pairedMasters || []).find((item) => item.instanceId === instanceId);
  if (!master) {
    throw new Error('Master is not in the paired list.');
  }
  const cached = AppContext.pairedPeerCache?.get(instanceId);
  const host = cached?.host || master.hostHint;
  const port = cached?.port || master.pairingPortHint;
  if (!host || !port) {
    throw new Error('Master is not reachable right now. Make sure it is running and on this network.');
  }
  return pairWithPeer(AppContext, {
    instanceId,
    name: master.name,
    host,
    port,
    addresses: cached?.addresses || [],
    hostHint: master.hostHint,
    pairingPortHint: master.pairingPortHint,
    natCompatibility: master.natCompatibility === true,
    txt: {
      instanceId,
      httpsEnabled: master.httpsEnabled === true ? 'true' : 'false',
      ...(cached?.hostname ? { hostname: cached.hostname } : {})
    },
    pairingPin
  });
}

// The master no longer accepts this device (it was forgotten there, or the
// pairing predates protocol v2). Stop connecting until the user pairs again.
function markMasterNeedsRepair(AppContext, instanceId, reason) {
  const masters = Array.isArray(AppContext.config.pairedMasters) ? AppContext.config.pairedMasters : [];
  const master = masters.find((item) => item.instanceId === instanceId);
  if (!master || (master.needsRepair && master.needsRepairReason === reason)) return false;
  master.needsRepair = true;
  master.needsRepairReason = reason;
  saveConfig(AppContext.config);
  notifyPairingsChanged();
  return true;
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

  notifyPairingsChanged();
  return { instanceId, removed };
}

module.exports = {
  PEER_PROTOCOL_VERSION,
  pairWithPeer,
  repairPeer,
  unpairPeer,
  markMasterNeedsRepair,
  notifyPairingsChanged
};
