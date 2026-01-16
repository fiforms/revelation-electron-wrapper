const http = require('http');
const os = require('os');
const { app } = require('electron');
const { signChallenge, fingerprintPublicKey } = require('./peerAuth');

const peerServer = {
  server: null,
  port: null,

  refresh(AppContext) {
    const enabled = AppContext.config.mdnsEnabled && AppContext.config.mode === 'network';
    if (!enabled) {
      this.stop(AppContext);
      return;
    }

    const desiredPort = AppContext.config.peerServerPort;
    if (this.server && this.port === desiredPort) return;
    this.stop(AppContext);
    this.start(AppContext);
  },

  start(AppContext) {
    const port = AppContext.config.peerServerPort;
    this.server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/peer/public-key') {
        return this.handlePublicKey(AppContext, res);
      }
      if (req.method === 'POST' && req.url === '/peer/challenge') {
        return this.handleChallenge(AppContext, req, res);
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    this.server.on('error', (err) => {
      AppContext.error(`Peer server error: ${err.message}`);
    });

    this.server.listen(port, '0.0.0.0', () => {
      this.port = port;
      AppContext.log(`Peer server listening on ${port}`);
    });
  },

  stop(AppContext) {
    if (!this.server) return;
    this.server.close(() => {
      AppContext.log('Peer server stopped');
    });
    this.server = null;
    this.port = null;
  },

  handlePublicKey(AppContext, res) {
    const publicKey = AppContext.config.rsaPublicKey;
    const payload = {
      instanceId: AppContext.config.mdnsInstanceId,
      instanceName: AppContext.config.mdnsInstanceName,
      hostname: os.hostname(),
      publicKey,
      publicKeyFingerprint: fingerprintPublicKey(publicKey || ''),
      appVersion: app.getVersion(),
      pairingPort: AppContext.config.peerServerPort
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  },

  handleChallenge(AppContext, req, res) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      let data;
      try {
        data = JSON.parse(body || '{}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
      const challenge = data.challenge;
      if (!challenge) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing challenge' }));
        return;
      }
      try {
        const signature = signChallenge(AppContext.config.rsaPrivateKey, challenge);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ signature }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  }
};

module.exports = { peerServer };
