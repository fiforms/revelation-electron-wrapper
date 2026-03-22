// Module to manage Vite and Reveal Remote Servers

const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { utilityProcess, app } = require('electron');


const serverManager = {
    viteProc: null,


    waitForServer(url, timeout = 10000, interval = 300) {
        return new Promise((resolve, reject) => {
            const start = Date.now();

            const check = () => {
            http.get(url, () => {
                if (this.viteProc) {
                resolve();
                } else {
                reject(new Error('Received response, but viteProc is null — likely a conflicting process'));
                }
            }).on('error', () => {
                if (Date.now() - start > timeout) {
                reject(new Error('Timeout waiting for server to start'));
                } else {
                setTimeout(check, interval);
                }
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
      }
      AppContext.log(`🌐 Host set to ${AppContext.hostURL} (LAN: ${AppContext.hostLANURL})`);
    
      await this.startServers(mode, AppContext); 
      callback?.();
    },   // switchMode

    async startServers(mode, AppContext) {
   
        const vitePortResult = await findAvailablePort(AppContext.config.viteServerPort, 20);
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
            AppContext.config.viteServerPort = vitePortResult.port;
        }

        // --- Start Vite ---
        const viteScript = path.join(AppContext.config.revelationDir, 'node_modules', 'vite', 'bin', 'vite.js');
        const args = ['--port', `${AppContext.config.viteServerPort}`];
        if (mode === 'network') args.unshift('--host');

        this.viteProc = utilityProcess.fork(viteScript, args, {
            cwd: AppContext.config.revelationDir,
            stdio: 'pipe',
            serviceName: 'Vite Dev Server',
            env: {
              ...process.env,
              REVELATION_GUI: 'true',
              PRESENTATIONS_DIR_OVERRIDE: AppContext.config.presentationsDir,
              PRESENTATIONS_KEY_OVERRIDE: AppContext.config.key,
              PLUGINS_DIR_OVERRIDE: AppContext.config.pluginFolder,
              USER_DATA_DIR: app.getPath('userData'),
              ADMIN_DIR_OVERRIDE: app.isPackaged
                    ? path.join(process.resourcesPath, 'http_admin')
                    : path.join(__dirname, '..', 'http_admin')
            }
        });

        AppContext.log('📦 Launching Vite:', viteScript);

        this.viteProc.on('spawn', () => AppContext.log('🚀 Vite server started'));
        this.viteProc.on('exit', (code) => AppContext.log(`🛑 Vite server exited (code ${code})`));
        this.viteProc.on('error', (err) => AppContext.error('💥 Vite process error:', err));
        this.viteProc.stdout?.on('data', (data) => AppContext.log(`[VITE STDOUT] ${data.toString().trim()}`));
        this.viteProc.stderr?.on('data', (data) => AppContext.error(`[VITE STDERR] ${data.toString().trim()}`));

        // --- Reveal Remote is now embedded in the Vite server ---
        writeRevealRemoteJSFile(
            mode === 'network' ? AppContext.config.viteServerPort : false,
            AppContext.config.presenterPluginsPublicServer,
            AppContext.config.revelationDir
        );
    },  // startServers


    stopServers(AppContext) {
        if (this.viteProc) {
            this.viteProc.kill();
            this.viteProc = null;
        }
        AppContext.log('🧹 Servers stopped');
    },  // stopServers

    getHostURL(mode) {
        if (mode === 'localhost') {
            return 'localhost';
        } else {
            return getLANAddress();
        }
    }  // getHostURL  
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

async function findAvailablePort(startPort, maxAttempts) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const candidate = startPort + i;
    if (await isPortAvailable(candidate)) {
      return { port: candidate, changed: i > 0 };
    }
  }
  return null;
}

function writeRevealRemoteJSFile(port, presenterPluginsPublicServer, revelationDir) {
  const outputPath = path.join(revelationDir, 'reveal-remote.js');
  const presenterSocketServer = String(presenterPluginsPublicServer || '').trim();
  const remoteLine = port
    ? `window.revealRemoteServer = window.location.protocol + "//" + window.location.hostname + ":${port}/";\n`
    : `window.revealRemoteServer = null;\n`;
  const presenterLine = `window.presenterPluginsPublicServer = ${JSON.stringify(presenterSocketServer || null)};\n`;
  const content = `${remoteLine}${presenterLine}`;

  try {
    fs.writeFileSync(outputPath, content, 'utf-8');
    console.log(`✅ Wrote reveal-remote.js with port ${port}`);
  } catch (err) {
    console.error(`❌ Failed to write reveal-remote.js: ${err.message}`);
  }
}

module.exports = { serverManager };
