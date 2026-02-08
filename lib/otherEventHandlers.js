// misc ipcMain handlers

const { shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { saveConfig } = require('./configManager');
const { app } = require('electron');
const { pairWithPeer, unpairPeer } = require('./peerPairing');
const { sendPeerCommand } = require('./peerCommandClient');
const { generateThemeThumbnails } = require('./themeThumbnailer');
const { checkForUpdates } = require('./updateChecker');

function normalizeAttribution(item) {
  const candidates = [
    item?.attribution,
    item?.attrib,
    item?.credit,
    item?.creator,
    item?.author,
    item?.copyright
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeAiFlag(item) {
  const raw = item?.ai ?? item?.ai_generated ?? item?.aigenerated ?? item?.aiGenerated;
  if (raw === true) return true;
  if (typeof raw === 'number') return raw > 0;
  if (typeof raw === 'string') {
    const val = raw.trim().toLowerCase();
    if (!val) return false;
    if (['yes', 'y', 'true', '1', 'ai', 'ai-generated', 'aigenerated', 'generated', 'gen'].includes(val)) {
      return true;
    }
    if (['no', 'n', 'false', '0'].includes(val)) return false;
  }
  return false;
}

function readSidecarMetadata(presDir, filename) {
  const exactMetaPath = path.join(presDir, `${filename}.json`);
  const baseMetaPath = path.join(
    presDir,
    `${path.basename(filename, path.extname(filename))}.json`
  );
  const candidates = [exactMetaPath, baseMetaPath];
  for (const metaPath of candidates) {
    if (!fs.existsSync(metaPath)) continue;
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch (err) {
      return null;
    }
  }
  return null;
}


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

        ipcMain.handle('delete-presentation', async (_event, slug, mdFile = 'presentation.md') => {
          const presentationsRoot = path.resolve(AppContext.config.presentationsDir);
          const presDir = path.resolve(presentationsRoot, slug || '');
          if (!presDir.startsWith(presentationsRoot + path.sep)) {
            return { success: false, error: 'Invalid presentation path' };
          }
          if (presDir === presentationsRoot) {
            return { success: false, error: 'Invalid presentation folder' };
          }

          const mdPath = path.resolve(presDir, mdFile || 'presentation.md');
          if (!mdPath.startsWith(presDir + path.sep)) {
            return { success: false, error: 'Invalid presentation file' };
          }

          if (!fs.existsSync(mdPath)) {
            return { success: false, error: 'Presentation file not found' };
          }

          const confirmationMessage = `Are you sure you want to delete this entire presentation (${slug}/${mdFile})? This process is irreversable.`;
          const { response } = await dialog.showMessageBox({
            type: 'warning',
            title: 'Delete Presentation',
            message: confirmationMessage,
            buttons: ['Delete', 'Cancel'],
            defaultId: 1,
            cancelId: 1
          });

          if (response !== 0) {
            return { success: false, canceled: true };
          }

          try {
            fs.unlinkSync(mdPath);
            const remainingMarkdown = fs.readdirSync(presDir)
              .filter((entry) => entry.toLowerCase().endsWith('.md'))
              .filter((entry) => fs.statSync(path.join(presDir, entry)).isFile());

            if (!remainingMarkdown.length) {
              fs.rmSync(presDir, { recursive: true, force: true });
              return { success: true, folderDeleted: true };
            }

            return { success: true, folderDeleted: false };
          } catch (err) {
            AppContext.error('Delete presentation failed:', err);
            return { success: false, error: err.message };
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
            allPluginFolders: AppContext.allPluginFolders || [],
            hostURL: AppContext.hostURL,
            hostLANURL: AppContext.hostLANURL
          };
        });

        ipcMain.handle('list-presentation-images', async (_event, slug) => {
          if (!slug) return [];
          const safeSlug = path.basename(String(slug));
          const presDir = path.join(AppContext.config.presentationsDir, safeSlug);
          if (!fs.existsSync(presDir)) return [];
          const allowedExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']);
          const entries = fs.readdirSync(presDir, { withFileTypes: true });
          const images = [];
          for (const entry of entries) {
            if (!entry.isFile()) continue;
            const filename = entry.name;
            if (filename.toLowerCase() === 'thumbnail.jpg') continue;
            const ext = path.extname(filename).toLowerCase();
            if (!allowedExts.has(ext)) continue;
            const meta = readSidecarMetadata(presDir, filename);
            images.push({
              filename,
              attribution: meta ? normalizeAttribution(meta) : '',
              ai: meta ? normalizeAiFlag(meta) : false
            });
          }
          images.sort((a, b) => a.filename.localeCompare(b.filename));
          return images;
        });

        ipcMain.handle('check-for-updates', async (_event, options = {}) => {
          return checkForUpdates(AppContext, { force: !!options.force });
        });

        ipcMain.handle('save-app-config', (_event, updates) => {
          if (updates?.mdnsPairingPin && typeof updates.mdnsPairingPin === 'string') {
            updates.mdnsPairingPin = updates.mdnsPairingPin.trim();
          }
          const enablingMdns = updates?.mdnsEnabled === true;
          const existingPin = AppContext.config.mdnsPairingPin;
          const providedPin = updates?.mdnsPairingPin;
          if (enablingMdns && !providedPin && !existingPin) {
            const length = 6;
            const min = 10 ** (length - 1);
            const max = 10 ** length - 1;
            updates.mdnsPairingPin = String(Math.floor(Math.random() * (max - min + 1)) + min);
          }
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
          const pairingPin = data?.pairingPin?.toString().trim();
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
            pairingPortHint: port,
            pairingPin
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
          const exclude = ['handout.css', 'presentations.css',  'mediaLibrary.css', 'lowerthirds.css', 'confidencemonitor.css', 'notes-teleprompter.css'];
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

        AppContext.callbacks['menu:generate-theme-thumbnails'] = async () => {
          const start = Date.now();
          try {
            AppContext.log('🎨 Generating theme thumbnails...');
            const result = await generateThemeThumbnails(AppContext);
            const elapsed = Math.round((Date.now() - start) / 1000);
            const failures = result.failures || [];
            const summary = failures.length
              ? `Finished with ${failures.length} failure(s) in ${elapsed}s.`
              : `Done in ${elapsed}s.`;
            const details = failures.map((f) => `• ${f.theme}: ${f.error}`).join('\n');

            await dialog.showMessageBox({
              type: failures.length ? 'warning' : 'info',
              title: 'Theme Thumbnails',
              message: `Generated ${result.total} theme thumbnail(s). ${summary}`,
              detail: details ? `\n${details}\n\nOutput: ${result.outputDir}` : `Output: ${result.outputDir}`
            });
          } catch (err) {
            AppContext.error(`Theme thumbnail generation failed: ${err.message}`);
            await dialog.showMessageBox({
              type: 'error',
              title: 'Theme Thumbnails',
              message: 'Theme thumbnail generation failed.',
              detail: err.message
            });
          }
        }
    }

}

module.exports = {
    otherEventHandlers
};
