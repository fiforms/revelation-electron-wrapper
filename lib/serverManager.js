// Module to manage Vite and Reveal Remote Servers

const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { utilityProcess, app } = require('electron');


const serverManager = {
    viteProc: null,
    remoteProc: null,


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
      if (this.remoteProc) {
        this.remoteProc.kill();
        waiters.push(waitForProcessExit(this.remoteProc));
      }
      await Promise.all(waiters);
    
      this.viteProc = null;
      this.remoteProc = null;
    
    
      if(mode == 'localhost') {
        AppContext.hostURL = 'localhost';
      }
      else {
        AppContext.hostURL = getLANAddress();
      }
      AppContext.log(`🌐 Host set to ${AppContext.hostURL}`);
    
      this.startServers(mode, AppContext); 
      callback?.();
    },   // switchMode

    async startServers(mode, AppContext) {
   
        const vitePortAvailable = await isPortAvailable(AppContext.config.viteServerPort);
        const remotePortAvailable = await isPortAvailable(AppContext.config.revealRemoteServerPort);
        AppContext.currentMode = mode;

        if (!vitePortAvailable) {
            AppContext.error(`❌ Port ${AppContext.config.viteServerPort} is already in use. Please close the process or change the port.`);
            AppContext.loadURL(`data:text/html,<h1>Port ${AppContext.config.viteServerPort} is already in use. Please close the process or change the port.</h1>`);
            return;
        }

        if (!remotePortAvailable && mode === 'network') {
            AppContext.error(`❌ Port ${AppContext.config.revealRemoteServerPort} is already in use. Please close the process or change the port.`);
            AppContext.win.loadURL(`data:text/html,<h1>Port ${AppContext.config.revealRemoteServerPort} is already in use. Please close the process or change the port.</h1>`);
            return;
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

        // --- Start Reveal.js Remote Server ---
        if (mode === 'network') {
            writeRevealRemoteJSFile(AppContext.config.revealRemoteServerPort, AppContext.config.revelationDir);

            const remoteScript = path.join(AppContext.config.revelationDir, 'node_modules', 'reveal.js-remote', 'server', 'index.js');

            this.remoteProc = utilityProcess.fork(remoteScript, [
                '--port', `${AppContext.config.revealRemoteServerPort}`,
                '--origin', '*',
                '--basepath', '/',
            ], {
                cwd: AppContext.config.revelationDir,
                stdio: 'pipe',
                serviceName: 'Reveal Remote Server',
            });

            this.remoteProc.on('spawn', () => AppContext.log('🚀 Reveal Remote server started'));
            this.remoteProc.on('exit', (code) => AppContext.log(`🛑 Remote server exited (code ${code})`));
            this.remoteProc.on('error', (err) => AppContext.error('💥 Remote server process error:', err));
            this.remoteProc.stdout?.on('data', (data) => AppContext.log(`[REMOTE STDOUT] ${data.toString().trim()}`));
            this.remoteProc.stderr?.on('data', (data) => AppContext.error(`[REMOTE STDERR] ${data.toString().trim()}`));
        }
        else {
            writeRevealRemoteJSFile(false, AppContext.config.revelationDir); // Clear out the file

        }
    },  // startServers


    stopServers(AppContext) {
        if (this.viteProc) {
            this.viteProc.kill();
            this.viteProc = null;
        }
        if (this.remoteProc) {
            this.remoteProc.kill();
            this.remoteProc = null;
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

function writeRevealRemoteJSFile(port, revelationDir) {
  const outputPath = path.join(revelationDir, 'reveal-remote.js');
  const content = port ? 
      `window.revealRemoteServer = window.location.protocol + "//" + window.location.hostname + ":${port}/";\n`
      : `window.revealRemoteServer = null;\n`;

  try {
    fs.writeFileSync(outputPath, content, 'utf-8');
    console.log(`✅ Wrote reveal-remote.js with port ${port}`);
  } catch (err) {
    console.error(`❌ Failed to write reveal-remote.js: ${err.message}`);
  }
}

module.exports = { serverManager };