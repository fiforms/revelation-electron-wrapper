// plugins/bibleworld/plugin.js
//
// Embedded browser integration for https://bibleworld.ai
//
// Behaviour:
//   - Opens a dedicated BrowserWindow on https://bibleworld.ai/explore using a
//     persistent session partition, so the user can browse and stay logged in.
//   - Authentication (Auth0 + Google/Microsoft/Facebook OAuth) is allowed to run
//     inside the embedded browser (including popups). Any other off-site link is
//     handed off to the system browser.
//   - When the user triggers a download, the file is captured, useful metadata is
//     scraped from the originating page, and the asset is imported into the shared
//     media library (_media) via mediaLibrary.hashAndStore(). Everything on the
//     site is CC0, so the license is fixed.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { BrowserWindow, session, shell, app } = require('electron');

const mediaLibPath = path.join(app.getAppPath(), 'lib', 'mediaLibrary.js');
const { mediaLibrary } = require(mediaLibPath);

const PLUGIN_NAME = 'bibleworld';
const PARTITION = 'persist:bibleworld';
const START_URL = 'https://bibleworld.ai/explore';
const LICENSE = 'CC0';

// Host suffixes allowed to navigate *inside* the embedded browser. Covers the
// site itself, its CDN, Auth0, and the three OAuth identity providers.
const ALLOWED_SUFFIXES = [
  'bibleworld.ai',
  'auth0.com',
  // Google
  'google.com', 'googleusercontent.com', 'googleapis.com', 'gstatic.com', 'accounts.google.com',
  // Microsoft
  'microsoftonline.com', 'microsoft.com', 'live.com', 'msauth.net', 'msftauth.net', 'office.com',
  // Facebook
  'facebook.com', 'facebook.net', 'fbcdn.net', 'fbsbx.com'
];

const MEDIA_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg',
  '.mp4', '.webm', '.mov', '.mp3', '.ogg', '.wav', '.m4a'
]);

let AppCtx = null;
let browserWindow = null;

// ---------------------------------------------------------------- URL helpers

function isWebUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function hostAllowed(urlStr) {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return ALLOWED_SUFFIXES.some((s) => host === s || host.endsWith('.' + s));
  } catch {
    return false;
  }
}

function openExternal(url) {
  shell.openExternal(url).catch((err) => {
    AppCtx && AppCtx.error('[bibleworld] Failed to open external URL:', err.message);
  });
}

function getDlName(urlStr) {
  // Download URLs look like .../<uuid>.png?dl=The%20Title.png&format=png
  try {
    const dl = new URL(urlStr).searchParams.get('dl');
    if (dl) return decodeURIComponent(dl);
  } catch { /* ignore */ }
  return '';
}

function stripExt(name) {
  return String(name || '').replace(/\.[a-z0-9]{1,5}$/i, '');
}

function sanitize(name) {
  return String(name || '').replace(/[^a-zA-Z0-9._ -]/g, '_').trim();
}

function pickExtension(dlName, urlStr, item) {
  const fromName = String(dlName).match(/\.[a-z0-9]{1,5}$/i);
  if (fromName && MEDIA_EXTS.has(fromName[0].toLowerCase())) return fromName[0].toLowerCase();

  try {
    const u = new URL(urlStr);
    const fmt = (u.searchParams.get('format') || '').toLowerCase().replace(/^\./, '');
    if (fmt && MEDIA_EXTS.has('.' + fmt)) return '.' + fmt;
    const pe = path.extname(u.pathname).toLowerCase();
    if (MEDIA_EXTS.has(pe)) return pe;
  } catch { /* ignore */ }

  const fe = path.extname(item.getFilename() || '').toLowerCase();
  if (MEDIA_EXTS.has(fe)) return fe;

  const mime = (typeof item.getMimeType === 'function' ? item.getMimeType() : '') || '';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('svg')) return '.svg';
  if (mime.includes('mp4')) return '.mp4';
  if (mime.includes('webm')) return '.webm';
  return '.png';
}

// ---------------------------------------------------------------- page scraping

// Runs in the bibleworld.ai page context to pull title/description/attribution.
// Kept self-contained so it can be serialised to executeJavaScript(). Accepts
// optional CSS selectors (configured by the user) and falls back to heuristics.
function pageScraper(sel) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const fromEl = (el) => clean(el && (el.content || el.textContent));
  const metaContent = (q) => {
    const el = document.querySelector(q);
    return el ? clean(el.getAttribute('content')) : '';
  };
  const bySelector = (s) => {
    if (!s) return '';
    try { return fromEl(document.querySelector(s)); } catch { return ''; }
  };

  let title = bySelector(sel.title)
    || metaContent('meta[property="og:title"]')
    || metaContent('meta[name="twitter:title"]')
    || clean((document.title || '').replace(/\s*[|–\-]\s*BibleWorld.*$/i, ''));

  const description = bySelector(sel.description)
    || metaContent('meta[property="og:description"]')
    || metaContent('meta[name="description"]')
    || metaContent('meta[name="twitter:description"]');

  let attribution = bySelector(sel.attribution);
  if (!attribution) {
    const re = /\/(users?|profiles?|creators?|artists?|authors?|by|u)\//i;
    const link = Array.from(document.querySelectorAll('a[href]'))
      .find((a) => re.test(a.getAttribute('href') || '') && clean(a.textContent));
    if (link) attribution = clean(link.textContent).replace(/^@/, '');
  }
  if (!attribution) {
    const bodyText = document.body ? document.body.innerText : '';
    const m = bodyText.match(/\b(?:by|artist|creator|created by)\s*[:\-]?\s*@?([A-Za-z0-9_.][A-Za-z0-9_. -]{1,38})/i);
    if (m) attribution = clean(m[1]);
  }

  return { title, description, attribution };
}

async function scrapePageMetadata(contents) {
  if (!contents || contents.isDestroyed()) return {};
  const cfg = AppCtx.plugins[PLUGIN_NAME]?.config || {};
  const sel = {
    title: cfg.titleSelector || '',
    description: cfg.descriptionSelector || '',
    attribution: cfg.attributionSelector || ''
  };
  const script = `(${pageScraper.toString()})(${JSON.stringify(sel)})`;
  try {
    return (await contents.executeJavaScript(script, true)) || {};
  } catch (err) {
    AppCtx.error('[bibleworld] Metadata scrape failed:', err.message);
    return {};
  }
}

function notifyPage(contents, message, isError = false) {
  if (!contents || contents.isDestroyed()) return;
  const bg = isError ? 'rgba(150,30,30,0.96)' : 'rgba(22,101,52,0.96)';
  const js = `(function(){try{
    var t=document.createElement('div');
    t.textContent=${JSON.stringify(message)};
    t.style.cssText='position:fixed;z-index:2147483647;right:18px;bottom:18px;max-width:380px;'
      +'padding:12px 16px;border-radius:10px;background:${bg};color:#fff;'
      +'font:600 14px/1.35 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.45);'
      +'opacity:0;transition:opacity .2s ease;pointer-events:none';
    document.body.appendChild(t);
    requestAnimationFrame(function(){t.style.opacity='1';});
    setTimeout(function(){t.style.opacity='0';setTimeout(function(){t.remove();},320);},4000);
  }catch(e){}})();`;
  contents.executeJavaScript(js, true).catch(() => {});
}

// ---------------------------------------------------------------- download capture

function registerDownloadCapture() {
  const ses = session.fromPartition(PARTITION);
  if (ses.__bibleworldDownloadHooked) return;
  ses.__bibleworldDownloadHooked = true;

  ses.on('will-download', (_event, item, webContents) => {
    const sourceUrl = item.getURL();
    const pageContents = webContents;
    let pageUrl = '';
    try { pageUrl = pageContents.getURL(); } catch { /* ignore */ }

    const dlName = getDlName(sourceUrl) || item.getFilename() || 'bibleworld-download';
    const ext = pickExtension(dlName, sourceUrl, item);
    const safeBase = sanitize(stripExt(dlName)) || 'bibleworld-download';
    const tmpPath = path.join(os.tmpdir(), `bibleworld-${Date.now()}-${safeBase}${ext}`);
    item.setSavePath(tmpPath);

    AppCtx.log(`[bibleworld] Capturing download: ${dlName} (${sourceUrl})`);

    item.once('done', async (_e, state) => {
      if (state !== 'completed') {
        AppCtx.error(`[bibleworld] Download did not complete (${state}): ${sourceUrl}`);
        notifyPage(pageContents, `⚠ Download ${state}`, true);
        return;
      }

      try {
        const scraped = await scrapePageMetadata(pageContents);
        const title = (stripExt(dlName).trim()) || scraped.title || safeBase;
        const metadata = {
          title,
          description: scraped.description || '',
          attribution: scraped.attribution || '',
          license: LICENSE,
          url_origin: pageUrl || '',
          url_library: pageUrl || '',
          url_direct: sourceUrl,
          original_filename: dlName
        };

        const result = await mediaLibrary.hashAndStore(tmpPath, metadata, AppCtx);
        const stored = result?.filename || 'media';
        AppCtx.log(`[bibleworld] Imported "${title}" → ${stored}` +
          (metadata.attribution ? ` (attribution: ${metadata.attribution})` : ''));
        notifyPage(pageContents, `✓ Imported “${title}” into the media library`);
      } catch (err) {
        AppCtx.error('[bibleworld] Import failed:', err.message);
        notifyPage(pageContents, `⚠ Import failed: ${err.message}`, true);
      } finally {
        fs.unlink(tmpPath, () => {});
      }
    });
  });
}

// ---------------------------------------------------------------- window + navigation

function attachNavigationHandlers(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    // OAuth providers frequently open popups (often starting at about:blank).
    if (url === 'about:blank' || !isWebUrl(url) || hostAllowed(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { partition: PARTITION }
        }
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (!isWebUrl(url)) return; // allow about:blank, data:, blob:, etc.
    if (!hostAllowed(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });

  // OAuth popups: wire the same handlers (and download capture via the shared
  // session) onto any child window the page spawns.
  contents.on('did-create-window', (childWin) => {
    try { childWin.setMenu(null); } catch { /* ignore */ }
    attachNavigationHandlers(childWin.webContents);
  });
}

function openExplorer() {
  registerDownloadCapture();

  if (browserWindow && !browserWindow.isDestroyed()) {
    if (browserWindow.isMinimized()) browserWindow.restore();
    browserWindow.focus();
    return;
  }

  browserWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'BibleWorld.ai',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  browserWindow.setMenu(null);
  attachNavigationHandlers(browserWindow.webContents);
  browserWindow.on('closed', () => { browserWindow = null; });

  AppCtx.log(`[bibleworld] Opening embedded browser: ${START_URL}`);
  browserWindow.loadURL(START_URL);
}

// ---------------------------------------------------------------- plugin definition

const plugin = {
  priority: 107,
  version: '0.1.0',
  pluginButtons: [
    { title: 'BibleWorld.ai', action: 'open-explorer' }
  ],
  configTemplate: [
    { name: 'titleSelector', type: 'string', description: 'Optional CSS selector for the title on bibleworld.ai item pages (leave blank to auto-detect)', default: '' },
    { name: 'descriptionSelector', type: 'string', description: 'Optional CSS selector for the description (leave blank to auto-detect)', default: '' },
    { name: 'attributionSelector', type: 'string', description: 'Optional CSS selector for the creator/attribution (leave blank to auto-detect)', default: '' }
  ],

  register(AppContext) {
    AppCtx = AppContext;
    AppContext.log('[bibleworld] Registered!');
  },

  api: {
    'open-explorer': async function () {
      try {
        openExplorer();
        return { success: true };
      } catch (err) {
        AppCtx.error('[bibleworld] open-explorer failed:', err.message);
        return { success: false, error: err.message };
      }
    }
  }
};

module.exports = plugin;
