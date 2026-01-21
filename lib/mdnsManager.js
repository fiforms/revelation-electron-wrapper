const os = require('os');
const { app } = require('electron');
const { fingerprintPublicKey } = require('./peerAuth');

const SERVICE_TYPE = 'revelation';

const mdnsManager = {
  bonjour: null,
  service: null,
  browser: null,
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

    if (this.bonjour && !keepBonjour) {
      this.bonjour.destroy();
      this.bonjour = null;
    }
  },

  handleServiceUp(AppContext, service) {
    const instanceId = service.txt?.instanceId;
    if (instanceId && instanceId === AppContext.config.mdnsInstanceId) return;

    const key = instanceId || `${service.name}:${service.host}:${service.port}`;
    this.peers.set(key, {
      instanceId: instanceId || null,
      name: service.name,
      host: service.host,
      port: service.port,
      addresses: service.addresses || [],
      txt: service.txt || {}
    });
    this.emitPeers(AppContext);
  },

  handleServiceDown(AppContext, service) {
    const instanceId = service.txt?.instanceId;
    const key = instanceId || `${service.name}:${service.host}:${service.port}`;
    if (this.peers.delete(key)) {
      this.emitPeers(AppContext);
    }
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

module.exports = { mdnsManager, defaultInstanceName };
