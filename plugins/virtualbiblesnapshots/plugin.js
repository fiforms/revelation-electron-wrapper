// plugins/virtualbiblesnapshots/plugin.js
const path = require('path');
const fs = require('fs');
const { BrowserWindow, app } = require('electron');
const mediaLibPath = path.join(app.getAppPath(), 'lib', 'mediaLibrary.js');
const { mediaLibrary, downloadToTemp, addMediaToFrontMatter } = require(mediaLibPath);

let AppCtx = null;

function buildVrbmMetadata(item, srcUrl) {
  const cfg = AppCtx.plugins['virtualbiblesnapshots']?.config || {};
  const libraryURL = item?.md5 && item?.filename
    ? `${cfg.apiBase}/browse/image/${item.md5}/${item.filename}`
    : '';

  return {
    title: item?.filename || 'VRBM Asset',
    keywords: item?.dir || '',
    description: item?.desc || '',
    attribution: item?.attribution || '',
    license: item?.license || '',
    ai: item?.ai || '',
    url_origin: item?.sourceurl || '',
    url_library: libraryURL || '',
    url_direct: srcUrl || ''
  };
}

function writeSidecarMetadata(destPath, metadata) {
  const metaPath = `${destPath}.json`;
  if (fs.existsSync(metaPath)) {
    AppCtx.log(`ℹ️ Metadata already exists: ${path.basename(metaPath)}`);
    return;
  }
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
  AppCtx.log(`✅ Metadata saved: ${path.basename(metaPath)}`);
}

function buildAttributionLine(item) {
  console.log(item);
  if (!item?.attribution) return '';
  const license = item?.license || '';
  return `© ${item.attribution} (${license})`;
}

async function downloadAssetToPresentation(item, presDir) {
  const srcUrl = item.largeurl || item.medurl;
  if (!srcUrl) throw new Error('Selected item has no downloadable URL.');

  let filename = '';
  try {
    const u = new URL(srcUrl);
    const filesParam = u.searchParams.get('files');
    if (filesParam) {
      filename = decodeURIComponent(filesParam);
    } else {
      filename = path.basename(u.pathname);
    }
  } catch {
    filename = path.basename(srcUrl.split('?')[0] || 'vrbm_image.jpg');
  }
  if (!path.extname(filename)) {
    filename += '.jpg';
  }
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const destPath = path.join(presDir, safeFilename);

  const tmpFile = await downloadToTemp(srcUrl);
  fs.copyFileSync(tmpFile, destPath);
  fs.unlink(tmpFile, err => {
    if (err) AppCtx.warn(`⚠️ Failed to delete temp file: ${tmpFile}`);
  });

  const metadata = buildVrbmMetadata(item, srcUrl);
  metadata.filename = safeFilename;
  metadata.original_filename = filename;
  writeSidecarMetadata(destPath, metadata);

  return { filename: safeFilename, encoded: encodeURIComponent(safeFilename) };
}

function openPluginWindow(params = {}) {
  /*
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({
    width: 1000,
    height: 800, modal: true, parent: AppCtx.win,
        webPreferences: { preload: AppCtx.preload }
  });
  */
  const url = `http://${AppCtx.hostURL}:${AppCtx.config.viteServerPort}/plugins_${AppCtx.config.key}/virtualbiblesnapshots/search.html?parames=${encodeURIComponent(JSON.stringify(params))}`;
  AppCtx.win.loadURL(url);
  // win.setMenu(null);
}

const plugin = {
  // optional client hook if you want menu entries later
  priority: 90,
  version: '0.2.0',
  clientHookJS: 'client.js',
  pluginButtons: [
      { "title": "VRBM Media", "page": "search.html" },
    ],
  // Basic configurable bits
  configTemplate: [
    { name: 'apiBase', type: 'string', description: 'VRBM API base', default: 'https://content.vrbm.org' },
    { name: 'libraries', type: 'string', description: 'Comma-separated library paths (e.g. /thumbs,/videos,/illustrations)', default: '/thumbs,/videos,/illustrations' },
    { name: 'downloadIntoMedia', type: 'boolean', description: 'Copy picked assets into _media and use media aliases', default: true }
  ],

  register(AppContext) {
    AppCtx = AppContext;
    AppContext.log('[virtualbiblesnapshots] Registered!');

  },

  api: {
    // Open the search dialog
    'open-search': async (_event, { slug, mdFile, returnKey, insertTarget, tagType }) => {
      const win = new BrowserWindow({
        width: 960, height: 720, modal: true, parent: AppCtx.win,
        webPreferences: { preload: AppCtx.preload }
      });
      win.setMenu(null);
      const key = AppCtx.config.key;
      const params = new URLSearchParams();
      params.set('slug', slug);
      params.set('md', mdFile);
      params.set('nosidebar', '1');
      if (returnKey) params.set('returnKey', returnKey);
      if (insertTarget) params.set('insertTarget', insertTarget);
      if (tagType) params.set('tagType', tagType);
      const url = `http://${AppCtx.hostURL}:${AppCtx.config.viteServerPort}/plugins_${key}/virtualbiblesnapshots/search.html?${params.toString()}`;
      win.loadURL(url);
      // win.webContents.openDevTools();
      return true;
    },

    'fetch-to-presentation': async (_event, { slug, item }) => {
      try {
        if (!slug) throw new Error('Missing presentation slug.');
        const presDir = path.join(AppCtx.config.presentationsDir, slug);
        if (!fs.existsSync(presDir)) throw new Error(`Presentation folder not found: ${presDir}`);
        const result = await downloadAssetToPresentation(item, presDir);
        const attrib = buildAttributionLine(item);
        const ai = item?.ai === true || String(item?.ai || '').toLowerCase() === 'yes';
        return { success: true, attrib, ai, ...result };
      } catch (err) {
        AppCtx.error('[virtualbiblesnapshots] fetch-to-presentation failed:', err.message);
        return { success: false, error: err.message };
      }
    },

    // insert-selected removed: builder now handles insertion via returnKey flow.
  }
};

module.exports = plugin;
