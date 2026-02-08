const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const { shell } = require('electron');
const { verifyChallenge } = require('./peerAuth');
const { presentationWindow } = require('./presentationWindow');

const SOCKET_INFO_ENDPOINT = '/peer/socket-info';
const COMMAND_ENDPOINT = '/peer/command';
const REFRESH_INTERVAL_MS = 10000;

function buildSocketPayload(token, expiresAt, socketPath) {
  return `${token}:${expiresAt}:${socketPath}`;
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
        path: parsed.pathname + parsed.search,
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

function loadSocketClient(AppContext) {
  try {
    return require('socket.io-client');
  } catch (err) {
    const altPath = path.join(AppContext.config.revelationDir, 'node_modules', 'socket.io-client');
    return require(altPath);
  }
}

function resolveMasterConnection(AppContext, master) {
  if (!master?.instanceId) return null;
  const cache = AppContext.pairedPeerCache || new Map();
  const cached = cache.get(master.instanceId);
  if (cached?.host && cached?.port) {
    return {
      master,
      host: cached.host,
      port: cached.port
    };
  }

  if (master.hostHint && master.pairingPortHint) {
    return {
      master,
      host: master.hostHint,
      port: master.pairingPortHint
    };
  }

  return null;
}

function handlePeerCommand(AppContext, command, sourceMasterId = 'unknown') {
  if (!command || typeof command !== 'object') return;

  AppContext.log(`Received peer command: ${command.type} from master ${sourceMasterId}`);

  switch (command.type) {
    case 'open-presentation': {
      const { url } = command.payload || {};
      if (!url) {
        AppContext.error('Peer command missing URL.');
        return;
      }
      presentationWindow.openWindow(AppContext, url, null, true);
      break;
    }
    case 'close-presentation': {
      if(!presentationWindow.presWindow || presentationWindow.presWindow.isDestroyed()) {
        AppContext.log('No presentation window open — ignoring remote close command.');
      }
      else {
        AppContext.log('Closing presentation window on remote close command.');
        presentationWindow.closeWindow({ suppressPeerBroadcast: true });
      }
      break;
    }
    default:
      AppContext.log(`Unhandled peer command: ${command.type}`);
  }
}

const peerCommandClient = {
  connections: new Map(),
  refreshTimer: null,

  start(AppContext) {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      this.refreshConnection(AppContext).catch((err) => {
        AppContext.error(`Peer command refresh failed: ${err.message}`);
      });
    }, REFRESH_INTERVAL_MS);
    this.refreshConnection(AppContext).catch((err) => {
      AppContext.error(`Peer command refresh failed: ${err.message}`);
    });
  },

  stop() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.disconnectAll();
  },

  disconnectMaster(masterId) {
    const existing = this.connections.get(masterId);
    if (!existing?.socket) return;
    existing.socket.removeAllListeners();
    existing.socket.disconnect();
    this.connections.delete(masterId);
  },

  disconnectAll() {
    for (const masterId of this.connections.keys()) {
      this.disconnectMaster(masterId);
    }
  },

  async refreshConnection(AppContext) {
    const masters = Array.isArray(AppContext.config.pairedMasters)
      ? AppContext.config.pairedMasters
      : [];
    if (!masters.length) {
      this.disconnectAll();
      return;
    }

    const desiredMasterIds = new Set();
    for (const master of masters) {
      if (!master?.instanceId) continue;
      desiredMasterIds.add(master.instanceId);
    }

    for (const masterId of this.connections.keys()) {
      if (!desiredMasterIds.has(masterId)) {
        this.disconnectMaster(masterId);
      }
    }

    const connectTasks = masters.map(async (master) => {
      const masterId = master?.instanceId;
      const selection = resolveMasterConnection(AppContext, master);
      if (!masterId || !selection?.host || !selection?.port || !master?.publicKey) {
        AppContext.error(`Peer command master ${masterId || 'unknown'} missing host, port, or public key.`);
        if (masterId) this.disconnectMaster(masterId);
        return;
      }

      const endpointKey = `${selection.host}:${selection.port}:${master.publicKey}:${master.pairingPin || ''}`;
      const existing = this.connections.get(masterId);
      if (existing?.endpointKey === endpointKey && existing.socket?.connected) {
        return;
      }

      const pin = master.pairingPin ? String(master.pairingPin) : '';
      const pinParam = pin ? `&pin=${encodeURIComponent(pin)}` : '';
      const socketInfo = await fetchJSON(
        `http://${selection.host}:${selection.port}${SOCKET_INFO_ENDPOINT}?instanceId=${encodeURIComponent(AppContext.config.mdnsInstanceId)}${pinParam}`
      );
      const { socketUrl, socketPath, token, expiresAt, signature } = socketInfo || {};
      if (!socketUrl || !socketPath || !token || !expiresAt || !signature) {
        throw new Error(`Incomplete socket info from master ${masterId}.`);
      }

      const payload = buildSocketPayload(token, expiresAt, socketPath);
      const ok = verifyChallenge(master.publicKey, payload, signature);
      if (!ok) {
        throw new Error(`Socket info signature verification failed for master ${masterId}.`);
      }

      this.disconnectMaster(masterId);
      const { io } = loadSocketClient(AppContext);
      const socket = io(socketUrl, {
        path: socketPath,
        auth: {
          token,
          expiresAt,
          signature,
          instanceId: AppContext.config.mdnsInstanceId
        },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 5000
      });

      this.connections.set(masterId, { socket, endpointKey });

      socket.on('connect', () => {
        AppContext.log(`Peer command connected to ${socketUrl} (${masterId})`);
      });
      socket.on('disconnect', (reason) => {
        AppContext.log(`Peer command disconnected (${masterId}): ${reason}`);
      });
      socket.on('connect_error', (err) => {
        AppContext.error(`Peer command connection error (${masterId}): ${err.message}`);
      });
      socket.on('peer-command', (command) => {
        handlePeerCommand(AppContext, command, masterId);
      });
    });

    const results = await Promise.allSettled(connectTasks);
    results.forEach((result) => {
      if (result.status === 'rejected') {
        AppContext.error(`Peer command refresh failed: ${result.reason?.message || result.reason}`);
      }
    });
  }
};

async function sendPeerCommand(AppContext, command) {
  if (!command?.type) {
    throw new Error('Command type is required.');
  }
  const url = `http://127.0.0.1:${AppContext.config.viteServerPort}${COMMAND_ENDPOINT}`;
  return fetchJSON(url, {
    method: 'POST',
    body: { command }
  });
}

module.exports = { peerCommandClient, sendPeerCommand };
