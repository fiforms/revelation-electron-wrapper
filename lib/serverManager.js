// Module to manage Vite and Reveal Remote Servers

const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { utilityProcess, app } = require('electron');
const { certManager } = require('./certManager');

// Default ports. These must stay far apart: startServers scans 20 ports up from
// the Vite port and apiServer scans 10 up from its own, so adjacent defaults
// (8000 / 8001) meant a single occupied port put Vite straight onto the API
// server. findAvailablePort's `exclude` now prevents the collision outright;
// the gap keeps the two ranges from overlapping in the first place.
const DEFAULT_VITE_PORT = 8000;   // scans 8000-8019
const DEFAULT_API_PORT = 8900;    // scans 8900-8909

// Socket.IO path of the presenter-plugins channel hosted by our own Vite
// server (see ensurePresenterPluginsServer in revelation/vite.plugins.js).
// Written as a relative path so decks resolve it against their own origin.
const LOCAL_PRESENTER_PLUGINS_PATH = '/presenter-plugins-socket';

const serverManager = {
    viteProc: null,
    _ipWatcherTimer: null,
    _lastWatchedIP: null,


    waitForServer(url, timeout = 10000, interval = 300) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const isHttps = url.startsWith('https://');
            const transport = isHttps ? https : http;

            let lastWrongServer = '';

            const retryOrFail = (reason) => {
                if (Date.now() - start > timeout) {
                    reject(new Error(reason));
                } else {
                    setTimeout(check, interval);
                }
            };

            const check = () => {
            // NOTE: rejectUnauthorized is disabled for self-signed HTTPS certificates.
            // The Vite server runs in HTTP by default. An optional HTTPS mode with self-signed
            // certificates was added to support plugins requiring secure contexts (e.g., WebRTC).
            // Self-signed HTTPS adds minimal real security but is necessary for plugin functionality.
            // This cert verification is only for the internal server health check, not for external clients.
            transport.get(url, { rejectUnauthorized: false }, (res) => {
                res.resume(); // drain so the socket can be reused/closed
                if (!this.viteProc) {
                    reject(new Error('Received response, but viteProc is null — likely a conflicting process'));
                    return;
                }
                // Something else may already own this port — most easily the
                // app's own API server, which answers every path with YAML.
                // Requiring an HTML document means we keep waiting for the real
                // Vite server instead of loading the wrong one and showing its
                // "Not Found" body as the main screen.
                const contentType = String(res.headers['content-type'] || '');
                if (!contentType.toLowerCase().includes('text/html')) {
                    lastWrongServer = `HTTP ${res.statusCode} ${contentType || 'no content-type'}`;
                    retryOrFail(
                        `Another server is answering on ${url} (${lastWrongServer}); Vite never came up. ` +
                        'Free that port or change Vite Server Port in Settings.'
                    );
                    return;
                }
                resolve();
            }).on('error', () => {
                retryOrFail(
                    lastWrongServer
                        ? `Timeout waiting for Vite at ${url}; a different server answered there (${lastWrongServer}).`
                        : 'Timeout waiting for server to start'
                );
            });
            };

            check();
        });
    },  // waitForServer


    async switchMode(mode, AppContext, callback, force = false) {
      if (mode === AppContext.currentMode && !force) return;
    
      AppContext.log(`🔁 Switching to ${mode} mode...`);
      AppContext.currentMode = mode;
    
      // Kill and wait for both processes
      const waiters = [];
      if (this.viteProc) {
        this.viteProc.kill();
        waiters.push(waitForProcessExit(this.viteProc));
      }
      await Promise.all(waiters);

      this.viteProc = null;
    
    
      AppContext.hostURL = 'localhost';
      if (mode === 'localhost') {
        AppContext.hostLANURL = 'localhost';
      } else {
        AppContext.hostLANURL = getLANAddress();
        this._lastWatchedIP = AppContext.hostLANURL;
      }
      AppContext.log(`🌐 Host set to ${AppContext.hostURL} (LAN: ${AppContext.hostLANURL})`);
    
      await this.startServers(mode, AppContext); 
      callback?.();
    },   // switchMode

    async startServers(mode, AppContext) {
   
        // Never let Vite land on the API server's port — see findAvailablePort.
        const vitePortResult = await findAvailablePort(
            AppContext.config.viteServerPort,
            20,
            [AppContext.config.apiServerPort]
        );
        AppContext.currentMode = mode;

        if (!vitePortResult) {
            AppContext.error(`❌ Port ${AppContext.config.viteServerPort} is already in use. Please close the process or change the port.`);
            if (AppContext.win) {
                AppContext.win.loadURL(`data:text/html,<h1>Port ${AppContext.config.viteServerPort} is already in use. Please close the process or change the port.</h1>`);
            }
            return;
        }

        if (vitePortResult.changed) {
            AppContext.log(`⚠️ Vite port ${AppContext.config.viteServerPort} was in use; using ${vitePortResult.port} for this session.`);
            // Remember what the user actually configured. config.viteServerPort
            // has to carry the *live* port (≈40 call sites build URLs from it),
            // but persisting a fallback would make a transient conflict a
            // permanent config change — and the drifted value could then collide
            // with the API port on the next launch. saveConfig() writes the
            // preference back instead. See configManager._buildSaveableObject.
            if (!Number.isFinite(Number(AppContext.config.configuredViteServerPort))) {
                AppContext.config.configuredViteServerPort = AppContext.config.viteServerPort;
            }
            AppContext.config.viteServerPort = vitePortResult.port;
        }

        // --- Start Vite ---
        const viteScript = path.join(AppContext.config.revelationDir, 'node_modules', 'vite', 'bin', 'vite.js');
        const args = ['--port', `${AppContext.config.viteServerPort}`];
        if (mode === 'network') args.unshift('--host');

        let env = {
              ...process.env,
              REVELATION_GUI: 'true',
              PRESENTATIONS_DIR_OVERRIDE: AppContext.config.presentationsDir,
              PRESENTATIONS_KEY_OVERRIDE: AppContext.config.key,
              PLUGINS_DIR_OVERRIDE: AppContext.config.pluginFolder,
              USER_DATA_DIR: app.getPath('userData'),
              ADMIN_DIR_OVERRIDE: app.isPackaged
                    ? path.join(process.resourcesPath, 'http_admin')
                    : path.join(__dirname, '..', 'http_admin')
            };

        // Handle HTTPS if enabled
        if (AppContext.config.httpsEnabled) {
          const certPaths = certManager.ensureCertificate(app.getPath('userData'));
          if (certPaths) {
            env.VITE_HTTPS_CERT = certPaths.certPath;
            env.VITE_HTTPS_KEY = certPaths.keyPath;
            AppContext.log('🔐 HTTPS enabled for Vite server');
          } else {
            AppContext.error('❌ HTTPS requested but certificate generation failed; running in HTTP mode');
            AppContext.config.httpsEnabled = false;
          }
        }

        if (AppContext.config.ffmpegPath) {
            env.FFMPEG_BIN = AppContext.config.ffmpegPath;
        }

        this.viteProc = utilityProcess.fork(viteScript, args, {
            cwd: AppContext.config.revelationDir,
            stdio: 'pipe',
            serviceName: 'Vite Dev Server',
            env: env
        });

        AppContext.log('📦 Launching Vite:', viteScript);

        this.viteProc.on('spawn', () => AppContext.log('🚀 Vite server started'));
        this.viteProc.on('exit', (code) => AppContext.log(`🛑 Vite server exited (code ${code})`));
        this.viteProc.on('error', (err) => AppContext.error('💥 Vite process error:', err));
        this.viteProc.stdout?.on('data', (data) => AppContext.log(`[VITE STDOUT] ${data.toString().trim()}`));
        this.viteProc.stderr?.on('data', (data) => AppContext.error(`[VITE STDERR] ${data.toString().trim()}`));

        // Fresh presenter-plugin room id for this server session. Runtime only
        // — never persisted, so every start gets a new room.
        AppContext.presenterLiveRoomId = require('crypto').randomBytes(16).toString('hex');

        // --- Reveal Remote is now embedded in the Vite server ---
        writeRevealRemoteJSFile({
            vitePort: mode === 'network' ? AppContext.config.viteServerPort : false,
            usePublicServer: AppContext.config.useRemotePublicServer === true,
            revealRemotePublicServer: AppContext.config.revealRemotePublicServer,
            presenterPluginsPublicServer: AppContext.config.presenterPluginsPublicServer,
            liveRoomId: AppContext.presenterLiveRoomId,
            revelationDir: AppContext.config.revelationDir
        });
    },  // startServers


    stopServers(AppContext) {
        if (this.viteProc) {
            this.viteProc.kill();
            this.viteProc = null;
        }
        AppContext.log('🧹 Servers stopped');
    },  // stopServers

    startIPWatcher(AppContext) {
        if (this._ipWatcherTimer) return;
        this._lastWatchedIP = getLANAddress();
        this._ipWatcherTimer = setInterval(() => {
            if (AppContext.config?.mode !== 'network') return;
            const currentIP = getLANAddress();
            if (currentIP === this._lastWatchedIP) return;
            const oldIP = this._lastWatchedIP;
            this._lastWatchedIP = currentIP;
            AppContext.hostLANURL = currentIP;
            AppContext.log(`🌐 LAN IP changed: ${oldIP} → ${currentIP}`);
            if (AppContext.win && !AppContext.win.isDestroyed()) {
                AppContext.win.webContents.send('lan-ip-changed', { oldIP, newIP: currentIP });
                AppContext.win.webContents.send('show-toast', `Network address changed to ${currentIP}`);
            }
        }, 5000);
    },  // startIPWatcher

    stopIPWatcher() {
        if (this._ipWatcherTimer) {
            clearInterval(this._ipWatcherTimer);
            this._ipWatcherTimer = null;
        }
    },  // stopIPWatcher

    getHostURL(mode) {
        if (mode === 'localhost') {
            return 'localhost';
        } else {
            return getLANAddress();
        }
    },  // getHostURL

    // Register an opaque token in the Vite process that maps to an absolute file path.
    // Returns the token string so the caller can build the /media-share/<token> URL.
    registerMediaToken(absolutePath) {
        const crypto = require('crypto');
        const token = crypto.randomBytes(24).toString('hex');
        if (this.viteProc) {
            this.viteProc.postMessage({
                type: 'register-media-token',
                token,
                absolutePath,
                mimeType: getMediaMimeType(absolutePath)
            });
        }
        return token;
    },  // registerMediaToken

    revokeMediaToken(token) {
        if (this.viteProc) {
            this.viteProc.postMessage({ type: 'revoke-media-token', token });
        }
    }  // revokeMediaToken
}

function getLANAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
            return iface.address;
        }
        }
    }
    return 'localhost'; // fallback
}

function waitForProcessExit(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.killed) return resolve(); // already gone
    proc.once('exit', () => resolve());
  });
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', function () {
        tester.close(() => resolve(true));
      })
      .listen(port);
  });
}  // isPortAvailable

// `exclude` lists ports that must never be chosen even when free — used so the
// Vite and API servers cannot land on each other. Without it, a Vite port that
// drifts upward can collide with the API server: both bind, the loser retries,
// and whichever wins answers the other's health check.
async function findAvailablePort(startPort, maxAttempts, exclude = []) {
  const blocked = new Set(
    (Array.isArray(exclude) ? exclude : [exclude]).map(Number).filter(Number.isFinite)
  );
  for (let i = 0; i < maxAttempts; i += 1) {
    const candidate = startPort + i;
    if (blocked.has(candidate)) continue;
    if (await isPortAvailable(candidate)) {
      return { port: candidate, changed: candidate !== startPort };
    }
  }
  return null;
}

// Point the decks' realtime channels at either this machine's Vite server
// (the default) or the configured public relay.
//
// Local is the default deliberately. Presentation traffic — and, until the
// room ids are reworked, the install's access key — should not leave the
// machine just because the app is running. The relay stays available as an
// explicit opt-in for the case it exists to serve: a remote control or viewer
// that cannot reach this LAN, e.g. a phone on cellular. See SECURITY.md (F3).
//
// `presenterPluginsPublicServer` is written as a *relative* path in local mode
// so it resolves against whatever origin the deck was loaded from — correct for
// the presenter window and for LAN browsers alike, and immune to the LAN IP
// changing mid-session.
function writeRevealRemoteJSFile({
  vitePort,
  usePublicServer,
  revealRemotePublicServer,
  presenterPluginsPublicServer,
  liveRoomId,
  revelationDir
}) {
  const outputPath = path.join(revelationDir, 'reveal-remote.js');

  let remoteLine;
  let presenterSocketServer;

  if (usePublicServer) {
    // Normalise the trailing slash: the local form ends in "/" and
    // reveal.js-remote concatenates paths onto this value.
    let publicRemote = String(revealRemotePublicServer || '').trim();
    if (publicRemote && !publicRemote.endsWith('/')) publicRemote += '/';
    remoteLine = `window.revealRemoteServer = ${JSON.stringify(publicRemote || null)};\n`;
    presenterSocketServer = String(presenterPluginsPublicServer || '').trim() || null;
  } else {
    remoteLine = vitePort
      ? `window.revealRemoteServer = window.location.protocol + "//" + window.location.hostname + ":${vitePort}/";\n`
      : `window.revealRemoteServer = null;\n`;
    presenterSocketServer = LOCAL_PRESENTER_PLUGINS_PATH;
  }

  const presenterLine = `window.presenterPluginsPublicServer = ${JSON.stringify(presenterSocketServer)};\n`;
  // Per-session id for presenter-plugin rooms that are not tied to a Reveal
  // multiplex session (currently just bibletext's live verse). It used to
  // derive its room name from config.key, which put the install's access key
  // into a room table — on a public relay, by default. A fresh random id each
  // server start also means restarting the app ejects collaborators, instead
  // of that requiring a key rotation that breaks every shared link.
  const liveRoomLine = `window.presenterLiveRoomId = ${JSON.stringify(liveRoomId)};\n`;
  const content = `${remoteLine}${presenterLine}${liveRoomLine}`;

  try {
    fs.writeFileSync(outputPath, content, 'utf-8');
    console.log(
      `✅ Wrote reveal-remote.js (${usePublicServer ? 'public relay' : 'local server'})`
    );
  } catch (err) {
    console.error(`❌ Failed to write reveal-remote.js: ${err.message}`);
  }
}

function getMediaMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.mp4': 'video/mp4',  '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.m4v': 'video/mp4',  '.ogv':  'video/ogg',  '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg', '.ogg':  'audio/ogg',  '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',  '.aac':  'audio/aac',  '.opus': 'audio/opus',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',  '.png': 'image/png',
    '.webp': 'image/webp','.gif':  'image/gif',   '.avif': 'image/avif',
    '.svg': 'image/svg+xml'
  };
  return types[ext] || 'application/octet-stream';
}


module.exports = { serverManager, findAvailablePort, DEFAULT_VITE_PORT, DEFAULT_API_PORT };
