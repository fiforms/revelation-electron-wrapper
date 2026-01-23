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

function pickMaster(AppContext) {
  const masters = Array.isArray(AppContext.config.pairedMasters)
    ? AppContext.config.pairedMasters
    : [];
  if (!masters.length) return null;

  const cache = AppContext.pairedPeerCache || new Map();
  const withHost = masters.find((master) => cache.get(master.instanceId)?.host);
  if (withHost) {
    const cached = cache.get(withHost.instanceId);
    return {
      master: withHost,
      host: cached.host,
      port: cached.port
    };
  }

  return null;
}

function handlePeerCommand(AppContext, command) {
  if (!command || typeof command !== 'object') return;

  switch (command.type) {
    case 'open-presentation': {
      const { slug, mdFile, fullscreen } = command.payload || {};
      if (!slug) {
        AppContext.error('Peer command missing slug.');
        return;
      }
      presentationWindow.openWindow(AppContext, slug, mdFile, fullscreen);
      break;
    }
    case 'close-presentation': {
      presentationWindow.closeWindow();
      break;
    }
    case 'open-link': {
      const url = command.payload?.url;
      if (!url) {
        AppContext.error('Peer command missing URL.');
        return;
      }
      shell.openExternal(url);
      break;
    }
    default:
      AppContext.log(`Unhandled peer command: ${command.type}`);
  }
}

const peerCommandClient = {
  socket: null,
  currentMasterId: null,
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
    this.disconnect();
  },

  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.currentMasterId = null;
  },

  async refreshConnection(AppContext) {
    const selection = pickMaster(AppContext);
    if (!selection) {
      this.disconnect();
      return;
    }

    const { master, host, port } = selection;
    if (!host || !port || !master?.publicKey) {
      AppContext.error('Peer command master missing host, port, or public key.');
      this.disconnect();
      return;
    }

    if (this.socket && this.currentMasterId === master.instanceId && this.socket.connected) {
      return;
    }

    const socketInfo = await fetchJSON(
      `http://${host}:${port}${SOCKET_INFO_ENDPOINT}?instanceId=${encodeURIComponent(AppContext.config.mdnsInstanceId)}`
    );
    const { socketUrl, socketPath, token, expiresAt, signature } = socketInfo || {};
    if (!socketUrl || !socketPath || !token || !expiresAt || !signature) {
      throw new Error('Incomplete socket info from master.');
    }

    const payload = buildSocketPayload(token, expiresAt, socketPath);
    const ok = verifyChallenge(master.publicKey, payload, signature);
    if (!ok) {
      throw new Error('Socket info signature verification failed.');
    }

    this.disconnect();
    const { io } = loadSocketClient(AppContext);
    this.currentMasterId = master.instanceId;
    this.socket = io(socketUrl, {
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

    this.socket.on('connect', () => {
      AppContext.log(`Peer command connected to ${socketUrl}`);
    });
    this.socket.on('disconnect', (reason) => {
      AppContext.log(`Peer command disconnected: ${reason}`);
    });
    this.socket.on('connect_error', (err) => {
      AppContext.error(`Peer command connection error: ${err.message}`);
    });
    this.socket.on('peer-command', (command) => {
      handlePeerCommand(AppContext, command);
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
