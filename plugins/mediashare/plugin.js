// plugins/mediashare/plugin.js

const { app, dialog, BrowserWindow } = require('electron');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

let AppCtx = null;
let managerWindow = null;

// token → { absolutePath, filename, mediaType, slug, tempDir }
const activeShares = new Map();

function getServerManager() {
  return require(path.join(app.getAppPath(), 'lib', 'serverManager.js')).serverManager;
}

function getPresentationWindow() {
  return require(path.join(app.getAppPath(), 'lib', 'presentationWindow.js')).presentationWindow;
}

function buildTempSlug() {
  return `_mediashare_${crypto.randomBytes(8).toString('hex')}`;
}

function detectMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.mkv'].includes(ext)) return 'video';
  if (['.mp3', '.ogg', '.wav', '.m4a', '.aac', '.opus'].includes(ext)) return 'audio';
  return 'image';
}

function buildPresentationMarkdown(tokenUrl, mediaType, filename) {
  const safeTitle = filename.replace(/"/g, "'");
  let slideContent;
  if (mediaType === 'video') {
    // data-imagefit + data-imagefill mirror what the framework emits for ![fit](video)
    slideContent = `<video src="${tokenUrl}" controls playsinline data-imagefit data-imagefill></video>`;
  } else if (mediaType === 'audio') {
    slideContent = `<div style="display:flex;align-items:center;justify-content:center;height:80vh">` +
      `<audio src="${tokenUrl}" controls autoplay style="width:80%"></audio></div>`;
  } else {
    // data-imagefit mirrors ![fit](image)
    slideContent = `<img src="${tokenUrl}" alt="${safeTitle}" data-imagefit data-imagefill>`;
  }
  return `---
title: "Media Share: ${safeTitle}"
alternatives: hidden
theme: revelation_dark.css
config:
  controls: false
  progress: false
  hash: false
  history: false
  transition: none
  width: 1920
  height: 1080
  margin: 0
---
${slideContent}
`;
}

function openManagerWindow() {
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.focus();
    return;
  }
  const key  = AppCtx.config.key;
  const port = AppCtx.config.viteServerPort;
  const host = AppCtx.hostURL;
  const url  = `http://${host}:${port}/plugins_${key}/mediashare/mediashare.html`;
  managerWindow = new BrowserWindow({
    width: 500,
    height: 480,
    title: 'Share Media to Peers',
    parent: AppCtx.win || undefined,
    webPreferences: { preload: AppCtx.preload }
  });
  managerWindow.setMenu(null);
  managerWindow.loadURL(url);
  managerWindow.on('closed', () => { managerWindow = null; });
}

function cleanupShare(token, share) {
  try { getServerManager().revokeMediaToken(token); } catch (_) {}
  try {
    if (share.tempDir && fs.existsSync(share.tempDir)) {
      fs.rmSync(share.tempDir, { recursive: true, force: true });
    }
  } catch (_) {}
}

const mediasharePlugin = {
  priority: 90,
  version: '1.0.0',

  register(AppContext) {
    AppCtx = AppContext;
    AppContext.log('[mediashare] Registered');

    // Add menu item to the Presentation submenu
    const presMenu = AppContext.mainMenuTemplate.find(m => m.label === 'Presentation');
    if (presMenu && Array.isArray(presMenu.submenu)) {
      presMenu.submenu.push(
        { type: 'separator' },
        { label: 'Share Media to Peers...', click: () => openManagerWindow() }
      );
    }

    // Revoke all tokens and delete temp dirs on quit
    app.on('before-quit', () => {
      for (const [token, share] of activeShares) {
        cleanupShare(token, share);
      }
      activeShares.clear();
    });
  },

  api: {

    'open-window': async function (_event, _data) {
      openManagerWindow();
      return { success: true };
    },

    'get-active-shares': async function (_event, _data) {
      const shares = [];
      for (const [token, share] of activeShares) {
        shares.push({ token, filename: share.filename, mediaType: share.mediaType });
      }
      return { success: true, shares };
    },

    'pick-and-share': async function (_event, _data) {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Media File to Share',
        properties: ['openFile'],
        filters: [
          {
            name: 'Media Files',
            extensions: [
              'mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv',
              'mp3', 'ogg', 'wav', 'm4a', 'aac', 'opus',
              'jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg'
            ]
          }
        ]
      });
      if (canceled || !filePaths.length) return { success: false, canceled: true };

      // Resolve symlinks and confirm it is a regular file
      let realPath;
      try {
        realPath = fs.realpathSync(filePaths[0]);
        if (!fs.statSync(realPath).isFile()) throw new Error('Not a regular file');
      } catch (err) {
        return { success: false, error: `Cannot read file: ${err.message}` };
      }

      const filename  = path.basename(realPath);
      const mediaType = detectMediaType(realPath);
      const slug      = buildTempSlug();
      const sm        = getServerManager();
      const token     = sm.registerMediaToken(realPath);
      const tokenUrl  = `/media-share/${token}`;

      // Create temp presentation directory and markdown
      const tempDir = path.join(AppCtx.config.presentationsDir, slug);
      try {
        fs.mkdirSync(tempDir, { recursive: true });
        const md = buildPresentationMarkdown(tokenUrl, mediaType, filename);
        fs.writeFileSync(path.join(tempDir, 'presentation.md'), md, 'utf-8');
      } catch (err) {
        sm.revokeMediaToken(token);
        return { success: false, error: `Failed to create temp presentation: ${err.message}` };
      }

      activeShares.set(token, { absolutePath: realPath, filename, mediaType, slug, tempDir });
      AppCtx.log(`[mediashare] Opening "${filename}" locally (token ${token.slice(0, 8)}…)`);

      // Open in the local presentation window — user presses Z to push to peers
      try {
        await getPresentationWindow().openWindow(AppCtx, slug, 'presentation.md', true);
      } catch (err) {
        AppCtx.error(`[mediashare] Failed to open presentation window: ${err.message}`);
      }

      return { success: true, token, filename, mediaType };
    },

    'stop-share': async function (_event, data) {
      const { token } = data || {};
      if (!token || !activeShares.has(token)) {
        return { success: false, error: 'Share not found' };
      }
      const share = activeShares.get(token);
      activeShares.delete(token);
      cleanupShare(token, share);
      AppCtx.log(`[mediashare] Stopped sharing "${share.filename}"`);
      return { success: true };
    },

    'stop-all-shares': async function (_event, _data) {
      for (const [token, share] of activeShares) {
        cleanupShare(token, share);
      }
      activeShares.clear();
      AppCtx.log('[mediashare] All shares stopped');
      return { success: true };
    }

  }
};

module.exports = mediasharePlugin;
