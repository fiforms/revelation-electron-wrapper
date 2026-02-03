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

function filenameFromUrl(srcUrl, fallback = 'downloaded') {
  try {
    const u = new URL(srcUrl);
    const filesParam = u.searchParams.get('files');
    if (filesParam) {
      return decodeURIComponent(filesParam);
    }
    return path.basename(u.pathname);
  } catch {
    return path.basename(srcUrl.split('?')[0] || fallback);
  }
}

async function downloadAssetToPresentation(item, presDir) {
  const preferHigh = AppCtx.config.preferHighBitrate || false;
  let srcUrl;
  if (preferHigh) {
    srcUrl = item.largeurl || item.medurl;
  } else {
    srcUrl = item.medurl || item.largeurl;
  }
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

async function downloadAssetToMediaLibrary(item) {
  const preferHigh = AppCtx.config.preferHighBitrate || false;
  const standardUrl = item.medurl || item.largeurl;
  const largeUrl = item.medurl && item.largeurl && item.largeurl !== item.medurl
    ? item.largeurl
    : null;
  if (!standardUrl) throw new Error('Selected item has no downloadable URL.');

  const tmpFile = await downloadToTemp(standardUrl);
  const metadata = buildVrbmMetadata(item, standardUrl);
  const result = await mediaLibrary.hashAndStore(tmpFile, metadata, AppCtx);
  fs.unlink(tmpFile, err => {
    if (err) AppCtx.warn(`⚠️ Failed to delete temp file: ${tmpFile}`);
  });

  const baseFilename = result?.filename || result?.stored?.[0]?.filename || null;
  if (!preferHigh && largeUrl && baseFilename) {
    const baseMetaPath = path.join(AppCtx.config.presentationsDir, '_media', `${baseFilename}.json`);
    if (fs.existsSync(baseMetaPath)) {
      try {
        const baseMeta = JSON.parse(fs.readFileSync(baseMetaPath, 'utf-8'));
        if (!baseMeta.large_variant) {
          const originalLarge = filenameFromUrl(largeUrl, 'large');
          let largeExt = path.extname(originalLarge);
          if (!largeExt) {
            largeExt = path.extname(baseFilename);
          }
          const baseHash = path.basename(baseFilename).split('.')[0];
          const largeFilename = `${baseHash}.highbitrate${largeExt}`;
          baseMeta.large_variant = {
            filename: largeFilename,
            original_filename: originalLarge,
            url_direct: largeUrl
          };
          baseMeta.large_variant_local = false;
          fs.writeFileSync(baseMetaPath, JSON.stringify(baseMeta, null, 2));
        }
      } catch (err) {
        AppCtx.warn(`⚠️ Failed to update metadata with large variant: ${err.message}`);
      }
    }
  }
  if (preferHigh && largeUrl && baseFilename) {
    const tmpLarge = await downloadToTemp(largeUrl);
    const largeMeta = buildVrbmMetadata(item, largeUrl);
    largeMeta.original_filename = filenameFromUrl(largeUrl, 'large');
    await mediaLibrary.hashAndStore(tmpLarge, largeMeta, AppCtx, baseFilename);
    fs.unlink(tmpLarge, err => {
      if (err) AppCtx.warn(`⚠️ Failed to delete temp file: ${tmpLarge}`);
    });
  }

  return result;
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

    'fetch-to-media-library': async (_event, { item }) => {
      try {
        const result = await downloadAssetToMediaLibrary(item);
        return { success: true, ...result };
      } catch (err) {
        AppCtx.error('[virtualbiblesnapshots] fetch-to-media-library failed:', err.message);
        return { success: false, error: err.message };
      }
    },

    // insert-selected removed: builder now handles insertion via returnKey flow.
  }
};

module.exports = plugin;
