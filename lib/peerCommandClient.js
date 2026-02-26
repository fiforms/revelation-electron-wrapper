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

function normalizeHost(host) {
  return String(host || '').trim().toLowerCase();
}

function normalizePort(port, fallback = null) {
  const parsed = Number.parseInt(port, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

function rewriteUrlAuthority(rawUrl, host, port) {
  const parsed = new URL(rawUrl);
  parsed.hostname = host;
  parsed.port = String(port);
  return parsed.toString();
}

function shouldRewriteForMaster(master, selection, parsedUrl) {
  if (master?.natCompatibility === true) return { enabled: true, reason: 'nat-compat' };
  if (!selection?.host || !selection?.port) return { enabled: false, reason: 'no-endpoint' };

  const targetHost = normalizeHost(selection.host);
  const targetPort = normalizePort(selection.port, null);
  if (!targetHost || !targetPort) return { enabled: false, reason: 'invalid-endpoint' };

  const topHostMismatch = normalizeHost(parsedUrl.hostname) !== targetHost;
  const topPortMismatch = normalizePort(parsedUrl.port, normalizePort(parsedUrl.protocol === 'https:' ? 443 : 80, null)) !== targetPort;
  if (topHostMismatch || topPortMismatch) {
    return { enabled: true, reason: 'top-url-mismatch' };
  }

  const nestedSrc = parsedUrl.searchParams.get('src');
  if (nestedSrc) {
    try {
      const nested = new URL(nestedSrc);
      const nestedHostMismatch = normalizeHost(nested.hostname) !== targetHost;
      const nestedPortMismatch = normalizePort(nested.port, normalizePort(nested.protocol === 'https:' ? 443 : 80, null)) !== targetPort;
      if (nestedHostMismatch || nestedPortMismatch) {
        return { enabled: true, reason: 'nested-src-mismatch' };
      }
    } catch {
      // Ignore malformed nested src URL
    }
  }

  return { enabled: false, reason: 'already-matching' };
}

function maybeRewritePeerPresentationUrl(AppContext, sourceMasterId, url) {
  if (!url || !sourceMasterId) return url;
  const masters = Array.isArray(AppContext?.config?.pairedMasters)
    ? AppContext.config.pairedMasters
    : [];
  const master = masters.find((entry) => entry?.instanceId === sourceMasterId);

  const selection = resolveMasterConnection(AppContext, master);
  if (!selection?.host || !selection?.port) {
    if (master?.natCompatibility) {
      AppContext.error(`NAT compatibility URL rewrite skipped: missing host/port for master ${sourceMasterId}.`);
    }
    return url;
  }

  try {
    const parsed = new URL(url);
    const rewriteDecision = shouldRewriteForMaster(master, selection, parsed);
    if (!rewriteDecision.enabled) return url;

    let rewritten = rewriteUrlAuthority(url, selection.host, selection.port);
    const rewrittenParsed = new URL(rewritten);
    const nestedSrc = rewrittenParsed.searchParams.get('src');
    if (nestedSrc) {
      try {
        const rewrittenSrc = rewriteUrlAuthority(nestedSrc, selection.host, selection.port);
        rewrittenParsed.searchParams.set('src', rewrittenSrc);
        rewritten = rewrittenParsed.toString();
      } catch {
        // Keep rewritten top-level URL even if nested src is malformed.
      }
    }

    if (rewritten !== url) {
      AppContext.log(`Peer URL rewritten for ${sourceMasterId} (${rewriteDecision.reason}): ${url} -> ${rewritten}`);
    }
    return rewritten;
  } catch (err) {
    AppContext.error(`Peer URL rewrite failed for ${sourceMasterId}: ${err.message}`);
    return url;
  }
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
      const resolvedUrl = maybeRewritePeerPresentationUrl(AppContext, sourceMasterId, url);
      presentationWindow.openWindow(AppContext, resolvedUrl, null, true);
      presentationWindow.openAdditionalScreensForPeerUrl(AppContext, resolvedUrl);
      break;
    }
    case 'close-presentation': {
      presentationWindow.syncPublishedScreenDefault?.(AppContext);
      if (presentationWindow.shouldUseAlwaysOpenBehavior?.(AppContext.config)) {
        presentationWindow.showDefaultOnMainPresentation(AppContext).catch((err) => {
          AppContext.error(`Failed to load main default screen: ${err.message}`);
        });
        presentationWindow.showDefaultOnAdditionalScreens(AppContext).catch((err) => {
          AppContext.error(`Failed to load virtual peer default screen: ${err.message}`);
        });
      } else {
        if(!presentationWindow.presWindow || presentationWindow.presWindow.isDestroyed()) {
          AppContext.log('No presentation window open — ignoring remote close command.');
        }
        else {
          AppContext.log('Closing presentation window on remote close command.');
          presentationWindow.closeWindow();
        }
        presentationWindow.closeAdditionalScreens();
      }
      break;
    }
    default:
      AppContext.log(`Unhandled peer command: ${command.type}`);
  }
}

const peerCommandClient = {
  connections: new Map(),
  masterWarnings: new Map(),
  toastCooldowns: new Map(),
  masterErrorHosts: new Set(),
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
    this.masterWarnings.clear();
    this.toastCooldowns.clear();
    this.masterErrorHosts.clear();
  },

  showToast(AppContext, key, message, cooldownMs = 0) {
    if (!AppContext?.win || AppContext.win.isDestroyed()) return;
    const now = Date.now();
    const lastAt = this.toastCooldowns.get(key) || 0;
    if (cooldownMs > 0 && now - lastAt < cooldownMs) return;
    this.toastCooldowns.set(key, now);
    AppContext.win.webContents.send('show-toast', message);
  },

  clearMasterErrorHost(hostKey) {
    if (!hostKey) return;
    this.masterErrorHosts.delete(hostKey);
  },

  showMasterErrorToastOnce(AppContext, hostKey, message) {
    if (!hostKey) {
      this.showToast(AppContext, `peer-connect-error:${message}`, message, 30000);
      return;
    }
    if (this.masterErrorHosts.has(hostKey)) return;
    this.masterErrorHosts.add(hostKey);
    this.showToast(AppContext, `peer-connect-error:${hostKey}`, message, 0);
  },

  setMasterWarning(AppContext, masterId, key, message) {
    if (!masterId) return;
    const previous = this.masterWarnings.get(masterId);
    if (previous === key) return;
    this.masterWarnings.set(masterId, key);
    AppContext.error(message);
  },

  clearMasterWarning(masterId) {
    if (!masterId) return;
    this.masterWarnings.delete(masterId);
  },

  async refreshConnection(AppContext) {
    if (AppContext.config.mdnsBrowse === false) {
      this.disconnectAll();
      return;
    }

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
    for (const masterId of this.masterWarnings.keys()) {
      if (!desiredMasterIds.has(masterId)) {
        this.masterWarnings.delete(masterId);
      }
    }

    const connectTasks = masters.map(async (master) => {
      const masterId = master?.instanceId;
      const selection = resolveMasterConnection(AppContext, master);
      if (!masterId || !selection?.host || !selection?.port || !master?.publicKey) {
        this.setMasterWarning(
          AppContext,
          masterId,
          'offline-missing-peer-info',
          `Peer command master ${masterId || 'unknown'} appears to be offline (missing host, port, or public key).`
        );
        if (masterId) this.disconnectMaster(masterId);
        return;
      }

      this.clearMasterWarning(masterId);

      const endpointKey = `${selection.host}:${selection.port}:${master.publicKey}:${master.pairingPin || ''}`;
      const existing = this.connections.get(masterId);
      if (existing?.endpointKey === endpointKey && existing.socket?.connected) {
        return;
      }

      const pin = master.pairingPin ? String(master.pairingPin) : '';
      const pinParam = pin ? `&pin=${encodeURIComponent(pin)}` : '';
      const hostKey = String(selection.host || '').trim();
      const masterLabel = master.name || masterId || 'master';
      try {
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
        const followerLabel = String(AppContext.config.mdnsInstanceName || '').trim();
        const socket = io(socketUrl, {
          path: socketPath,
          auth: {
            token,
            expiresAt,
            signature,
            instanceId: AppContext.config.mdnsInstanceId,
            instanceName: followerLabel,
            // Courtesy label shown on master side; prefer user-defined name.
            hostname: followerLabel || AppContext.config.mdnsInstanceId || 'unknown'
          },
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          timeout: 5000
        });

        this.connections.set(masterId, {
          socket,
          endpointKey,
          host: selection.host,
          port: selection.port,
          name: masterLabel,
          instanceId: masterId
        });

        socket.on('connect', () => {
          this.clearMasterErrorHost(hostKey);
          AppContext.log(`Peer command connected to ${socketUrl} (${masterId})`);
          this.showToast(
            AppContext,
            `peer-connected:${masterId}`,
            `Connected to master: ${masterLabel}`,
            5000
          );
        });
        socket.on('disconnect', (reason) => {
          AppContext.log(`Peer command disconnected (${masterId}): ${reason}`);
        });
        socket.on('connect_error', (err) => {
          AppContext.error(`Peer command connection error (${masterId}): ${err.message}`);
          this.showMasterErrorToastOnce(
            AppContext,
            hostKey,
            `Master connection error (${masterLabel}): ${err.message}`
          );
        });
        socket.on('peer-command', (command) => {
          handlePeerCommand(AppContext, command, masterId);
        });
      } catch (err) {
        this.showMasterErrorToastOnce(
          AppContext,
          hostKey,
          `Master connection error (${masterLabel}): ${err.message || err}`
        );
        throw err;
      }
    });

    const results = await Promise.allSettled(connectTasks);
    results.forEach((result) => {
      if (result.status === 'rejected') {
        const msg = result.reason?.message || String(result.reason);
        AppContext.error(`Peer command refresh failed: ${msg}`);
      }
    });
  },

  getMasterStatuses(AppContext) {
    const masters = Array.isArray(AppContext?.config?.pairedMasters)
      ? AppContext.config.pairedMasters
      : [];

    const statuses = [];
    const seen = new Set();

    for (const connection of this.connections.values()) {
      if (!connection?.socket?.connected) continue;
      const masterId = String(connection.instanceId || '').trim();
      const key = masterId || `${connection.host || ''}:${connection.port || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      statuses.push({
        instanceId: masterId,
        name: connection.name || '',
        host: connection.host || null,
        port: connection.port || null,
        connected: true
      });
    }

    // Keep paired records visible to callers as disconnected entries if needed.
    for (const master of masters) {
      const masterId = String(master?.instanceId || '').trim();
      if (!masterId || seen.has(masterId)) continue;
      const selection = resolveMasterConnection(AppContext, master) || {};
      statuses.push({
        instanceId: masterId,
        name: master?.name || '',
        host: selection.host || null,
        port: selection.port || null,
        connected: false
      });
    }

    return statuses;
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
