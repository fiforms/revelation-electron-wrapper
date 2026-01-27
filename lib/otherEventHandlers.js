// misc ipcMain handlers

const { shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { saveConfig } = require('./configManager');
const { app } = require('electron');
const { pairWithPeer, unpairPeer } = require('./peerPairing');
const { sendPeerCommand } = require('./peerCommandClient');


const otherEventHandlers = {
    register(ipcMain, AppContext) {

        // Handle opening external URLs
        ipcMain.on('open-external-url', (_event, href) => {
            AppContext.log('[main] Opening external URL:', href);
            shell.openExternal(href);
        });

        // Show the folder containing the presentation files
        ipcMain.handle('show-presentation-folder', async (_event, slug) => {
          const folder = path.join(AppContext.config.presentationsDir, slug);
          if (fs.existsSync(folder)) {
            shell.openPath(folder); // Opens the folder in file browser
            return { success: true };
          } else {
            return { success: false, error: 'Folder not found' };
          }
        });

        // Handle opening the presentation in the default editor
        ipcMain.handle('edit-presentation', async (_event, slug, mdFile = 'presentation.md') => {
          const filePath = path.join(AppContext.config.presentationsDir, slug, mdFile);
          if (fs.existsSync(filePath)) {
            return shell.openPath(filePath); // Opens in system default editor
          } else {
            throw new Error(`File not found: ${filePath}`);
          }
        });

        ipcMain.handle('get-app-config', () => {
          const safeConfig = { ...AppContext.config };
          delete safeConfig.rsaPrivateKey;
          delete safeConfig.mdnsAuthToken;
          return {
            ...safeConfig,
            allPluginFolders: AppContext.allPluginFolders || []
          };
        });

        ipcMain.handle('save-app-config', (_event, updates) => {
          Object.assign(AppContext.config, updates);
          saveConfig(AppContext.config);
          return { success: true };
        });

        ipcMain.handle('select-presentations-dir', async () => {
          const { dialog } = require('electron');
          const { canceled, filePaths } = await dialog.showOpenDialog({
            title: 'Select Presentations Folder',
            properties: ['openDirectory']
          });

          if (canceled || !filePaths.length) return null;
          return filePaths[0];
        });

        ipcMain.handle('save-current-presentation', async (_event, data) => {
          try {
            const storeFile = path.join(app.getPath('userData'), 'currentPresentation.json');
            fs.writeFileSync(storeFile, JSON.stringify(data, null, 2));
            AppContext.log(`💾 Saved current presentation: ${data.slug}`);
            return { success: true };
          } catch (err) {
            AppContext.error('Failed to save current presentation:', err);
            return { success: false, error: err.message };
          }
        });

        ipcMain.handle('get-current-presentation', async () => {
          try {
            const storeFile = path.join(app.getPath('userData'), 'currentPresentation.json');
            if (fs.existsSync(storeFile)) {
              const data = JSON.parse(fs.readFileSync(storeFile, 'utf-8'));
              return data;
            }
            return null;
          } catch (err) {
            AppContext.error('Failed to load current presentation:', err);
            return null;
          }
        });

        ipcMain.handle('clear-current-presentation', async () => {
          try {
            const storeFile = path.join(app.getPath('userData'), 'currentPresentation.json');
            if (fs.existsSync(storeFile)) fs.unlinkSync(storeFile);
            AppContext.log('🗑️ Cleared current presentation');
            return { success: true };
          } catch (err) {
            AppContext.error('Failed to clear current presentation:', err);
            return { success: false, error: err.message };
          }
        });

        ipcMain.handle('get-display-list', () => {
          const { screen } = require('electron');
          return screen.getAllDisplays();
        });

        ipcMain.handle('get-runtime-info', () => {
          const argv = Array.isArray(process.argv) ? process.argv : [];
          const hasOzoneX11 = argv.some((arg, i) =>
            arg === '--ozone-platform=x11' ||
            (arg === '--ozone-platform' && argv[i + 1] === 'x11')
          );
          return {
            sessionType: process.env.XDG_SESSION_TYPE || '',
            hasOzoneX11
          };
        });

        ipcMain.handle('get-mdns-peers', () => {
          return AppContext.mdnsPeers || [];
        });

        ipcMain.handle('get-paired-masters', () => {
          const masters = AppContext.config.pairedMasters || [];
          const cache = AppContext.pairedPeerCache;
          if (!cache || !cache.size) return masters;
          return masters.map((master) => {
            const cached = cache.get(master.instanceId);
            if (!cached) return master;
            return {
              ...master,
              host: cached.host,
              pairingPort: cached.port,
              addresses: cached.addresses,
              hostname: cached.hostname,
              lastSeen: cached.lastSeen
            };
          });
        });

        ipcMain.handle('pair-with-peer', async (_event, peer) => {
          const result = await pairWithPeer(AppContext, peer);
          return { success: true, master: result };
        });

        ipcMain.handle('pair-with-peer-ip', async (_event, data) => {
          const host = data?.host?.trim();
          const port = Number.parseInt(data?.port, 10);
          if (!host) {
            throw new Error('IP address is required.');
          }
          if (!Number.isFinite(port) || port <= 0) {
            throw new Error('Pairing port is required.');
          }
          const peer = {
            host,
            port,
            hostHint: host,
            pairingPortHint: port
          };
          const result = await pairWithPeer(AppContext, peer);
          return { success: true, master: result };
        });

        ipcMain.handle('unpair-peer', async (_event, master) => {
          const result = await unpairPeer(AppContext, master);
          return { success: true, ...result };
        });

        ipcMain.handle('send-peer-command', async (_event, command) => {
          const result = await sendPeerCommand(AppContext, command);
          return { success: true, result };
        });

        ipcMain.handle('getAvailableThemes', async () => {
          const themeDir = path.resolve(__dirname, '../revelation/dist/css');
          const exclude = ['handout.css', 'presentations.css']; // add more if needed
          const themes = fs.readdirSync(themeDir)
            .filter(file => file.endsWith('.css') && !exclude.includes(file));
          return themes;
        });

        AppContext.callbacks['menu:open-debug-log'] = () => {
          return shell.openPath(AppContext.config.logFile);
        }
        AppContext.callbacks['menu:clear-debug-log'] = () => {
          return AppContext.resetLog();
        }

        AppContext.callbacks['menu:show-library'] = () => {
          const key = AppContext.config.key;
          const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/media-library.html?key=${key}`
          AppContext.win.loadURL(url);
        }

        AppContext.callbacks['menu:show-presentation-list'] = () => {
          const key = AppContext.config.key;
          const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/presentations.html?key=${key}`
          AppContext.win.loadURL(url);
        }
    }

}

module.exports = {
    otherEventHandlers
};
