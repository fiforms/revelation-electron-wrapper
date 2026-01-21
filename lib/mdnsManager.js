const os = require('os');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { app } = require('electron');
const { generateChallenge, verifyChallenge, fingerprintPublicKey } = require('./peerAuth');

const SERVICE_TYPE = 'revelation';

const mdnsManager = {
  bonjour: null,
  service: null,
  browser: null,
  refreshInterval: null,
  peers: new Map(),

  refresh(AppContext) {
    const enabled = AppContext.config.mdnsEnabled && AppContext.config.mode === 'network';
    if (!enabled) {
      this.stop(AppContext);
      if (AppContext.config.mdnsEnabled && AppContext.config.mode !== 'network') {
        AppContext.log('mDNS discovery is enabled, but Networking is not set to network mode.');
      }
      return;
    }

    if (!this.bonjour) {
      if (!this.start(AppContext)) return;
    }

    const desiredName = AppContext.config.mdnsInstanceName || '';
    const desiredPort = AppContext.config.viteServerPort;
    const needsRestart = !this.service ||
      this.service.name !== desiredName ||
      this.service.port !== desiredPort;

    if (needsRestart) {
      this.stop(AppContext, { keepBonjour: true });
      this.start(AppContext);
    }
  },

  start(AppContext) {
    let Bonjour;
    try {
      ({ Bonjour } = require('bonjour-service'));
    } catch (err) {
      AppContext.error(`mDNS unavailable (bonjour-service missing): ${err.message}`);
      return false;
    }

    if (!this.bonjour) {
      this.bonjour = new Bonjour();
    }

    const instanceId = AppContext.config.mdnsInstanceId;
    const instanceName = AppContext.config.mdnsInstanceName || defaultInstanceName();
    const port = AppContext.config.viteServerPort;
    const pairingPort = AppContext.config.viteServerPort;
    const mode = AppContext.config.mode;
    const host = mdnsHostname();

    this.service = this.bonjour.publish({
      name: instanceName,
      type: SERVICE_TYPE,
      host,
      port,
      disableIPv6: true,
      txt: {
        instanceId,
        mode,
        version: app.getVersion(),
        hostname: os.hostname(),
        pairingPort,
        pubKeyFingerprint: fingerprintPublicKey(AppContext.config.rsaPublicKey || '')
      }
    });

    this.service.on('error', (err) => {
      AppContext.error('mDNS publish error:', err.message);
    });

    this.browser = this.bonjour.find({ type: SERVICE_TYPE });
    this.browser.on('up', (service) => this.handleServiceUp(AppContext, service));
    this.browser.on('down', (service) => this.handleServiceDown(AppContext, service));

    if (!this.refreshInterval) {
      this.refreshInterval = setInterval(() => {
        if (this.browser) this.browser.update();
      }, 15000);
    }

    AppContext.log(`mDNS announce started on ${host}: ${instanceName} (${SERVICE_TYPE})`);
    return true;
  },

  stop(AppContext, { keepBonjour = false } = {}) {
    if (this.browser) {
      this.browser.removeAllListeners();
      this.browser.stop();
      this.browser = null;
    }
    if (this.service) {
      this.service.stop();
      this.service = null;
    }
    this.peers.clear();
    this.emitPeers(AppContext);

    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    if (this.bonjour && !keepBonjour) {
      this.bonjour.destroy();
      this.bonjour = null;
    }
  },

  handleServiceUp(AppContext, service) {
    const instanceId = service.txt?.instanceId;
    if (instanceId && instanceId === AppContext.config.mdnsInstanceId) return;

    const pairedMaster = instanceId ? findPairedMaster(AppContext, instanceId) : null;
    if (pairedMaster) {
      verifyPairedMaster(AppContext, service, pairedMaster)
        .then((verified) => {
          if (!verified) return;
          this.addPeer(AppContext, service, instanceId);
          cachePairedPeer(AppContext, instanceId, service);
          this.emitPeers(AppContext);
        });
      return;
    }

    this.addPeer(AppContext, service, instanceId);
    this.emitPeers(AppContext);
  },

  handleServiceDown(AppContext, service) {
    const instanceId = service.txt?.instanceId;
    const key = instanceId || `${service.name}:${service.host}:${service.port}`;
    if (this.peers.delete(key)) {
      this.emitPeers(AppContext);
    }
    if (instanceId) {
      AppContext.pairedPeerCache?.delete(instanceId);
    }
  },

  addPeer(AppContext, service, instanceId) {
    const key = instanceId || `${service.name}:${service.host}:${service.port}`;
    this.peers.set(key, {
      instanceId: instanceId || null,
      name: service.name,
      host: service.host,
      port: service.port,
      addresses: service.addresses || [],
      txt: service.txt || {}
    });
  },

  emitPeers(AppContext) {
    const peers = Array.from(this.peers.values());
    AppContext.mdnsPeers = peers;
    if (AppContext.win && !AppContext.win.isDestroyed()) {
      AppContext.win.webContents.send('mdns-peers-updated', peers);
    }
  }
};

function defaultInstanceName() {
  const username = os.userInfo().username || 'user';
  return `${username}@${os.hostname()}`;
}

function mdnsHostname() {
  const hostname = os.hostname();
  return hostname.endsWith('.local') ? hostname : `${hostname}.local`;
}

function findPairedMaster(AppContext, instanceId) {
  return Array.isArray(AppContext.config.pairedMasters)
    ? AppContext.config.pairedMasters.find((peer) => peer.instanceId === instanceId)
    : null;
}

function cachePairedPeer(AppContext, instanceId, service) {
  if (!AppContext.pairedPeerCache) {
    AppContext.pairedPeerCache = new Map();
  }
  AppContext.pairedPeerCache.set(instanceId, {
    host: service.host,
    port: service.port,
    addresses: service.addresses || [],
    hostname: service.txt?.hostname || null,
    lastSeen: new Date().toISOString()
  });
}

function pickPeerHost(service) {
  const addresses = Array.isArray(service.addresses) ? service.addresses : [];
  const ipv4 = addresses.find((addr) => typeof addr === 'string' && addr.includes('.'));
  return ipv4 || service.host;
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

async function verifyPairedMaster(AppContext, service, pairedMaster) {
  if (!pairedMaster?.publicKey) {
    AppContext.error('mDNS peer verification failed: missing public key.');
    return false;
  }

  const host = pickPeerHost(service);
  const pairingPort = service.port || service.txt?.pairingPort;
  if (!host || !pairingPort) {
    AppContext.error('mDNS peer verification failed: missing host or port.');
    return false;
  }

  const challenge = generateChallenge();
  try {
    const response = await fetchJSON(`http://${host}:${pairingPort}/peer/challenge`, {
      method: 'POST',
      body: { challenge }
    });
    if (!response.signature) {
      throw new Error('Missing signature.');
    }
    const ok = verifyChallenge(pairedMaster.publicKey, challenge, response.signature);
    if (!ok) {
      throw new Error('Challenge verification failed.');
    }
    AppContext.log(`mDNS peer verified: ${pairedMaster.instanceId} (${service.name})`);
    return true;
  } catch (err) {
    AppContext.error(`mDNS peer verification failed for ${pairedMaster.instanceId}: ${err.message}`);
    return false;
  }
}

module.exports = { mdnsManager, defaultInstanceName };
