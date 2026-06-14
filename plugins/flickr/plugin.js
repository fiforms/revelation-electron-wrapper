// plugins/flickr/plugin.js
//
// Embedded browser integration for https://www.flickr.com
//
// Behaviour:
//   - Opens a dedicated BrowserWindow on https://www.flickr.com/explore using a
//     persistent session partition, so the user can browse and stay logged in.
//   - Authentication (Flickr/SmugMug + Google/Apple/Facebook OAuth) is allowed to
//     run inside the embedded browser (including popups). Any other off-site link
//     is handed off to the system browser.
//   - When the user triggers a download, the file is captured, useful metadata is
//     scraped from the originating photo page, and the asset is imported into the
//     shared media library (_media) via mediaLibrary.hashAndStore().
//
// NOTE: Unlike CC0-only sites, Flickr photos carry many different licenses
// (All Rights Reserved, the various Creative Commons licenses, CC0, Public
// Domain). The license is scraped per photo — never assumed — so you can respect
// each photographer's terms.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { BrowserWindow, session, shell, app } = require('electron');

const mediaLibPath = path.join(app.getAppPath(), 'lib', 'mediaLibrary.js');
const { mediaLibrary } = require(mediaLibPath);

const PLUGIN_NAME = 'flickr';
const PARTITION = 'persist:flickr';
const START_URL = 'https://www.flickr.com/explore';

// Host suffixes allowed to navigate *inside* the embedded browser. Covers Flickr,
// its static CDN, the SmugMug/Yahoo identity stack, and the OAuth providers.
const ALLOWED_SUFFIXES = [
  'flickr.com',
  'staticflickr.com',
  'flickr.net',
  'smugmug.com',
  // Legacy Yahoo identity / assets
  'yahoo.com', 'yimg.com',
  // Google
  'google.com', 'googleusercontent.com', 'googleapis.com', 'gstatic.com', 'accounts.google.com',
  // Apple
  'apple.com', 'icloud.com',
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
    AppCtx && AppCtx.error('[flickr] Failed to open external URL:', err.message);
  });
}

function stripExt(name) {
  return String(name || '').replace(/\.[a-z0-9]{1,5}$/i, '');
}

function sanitize(name) {
  return String(name || '').replace(/[^a-zA-Z0-9._ -]/g, '_').trim();
}

function pickExtension(suggestedName, urlStr, item) {
  const fromName = String(suggestedName).match(/\.[a-z0-9]{1,5}$/i);
  if (fromName && MEDIA_EXTS.has(fromName[0].toLowerCase())) return fromName[0].toLowerCase();

  try {
    const pe = path.extname(new URL(urlStr).pathname).toLowerCase();
    if (MEDIA_EXTS.has(pe)) return pe;
  } catch { /* ignore */ }

  const fe = path.extname(item.getFilename() || '').toLowerCase();
  if (MEDIA_EXTS.has(fe)) return fe;

  const mime = (typeof item.getMimeType === 'function' ? item.getMimeType() : '') || '';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('mp4')) return '.mp4';
  if (mime.includes('webm')) return '.webm';
  return '.jpg';
}

// ---------------------------------------------------------------- page scraping

// Runs in the Flickr page context to pull title/description/attribution/license.
// Kept self-contained so it can be serialised to executeJavaScript(). Accepts
// optional CSS selectors (configured by the user) and falls back to heuristics:
// JSON-LD ImageObject, OpenGraph/meta tags, owner-name elements, and the
// Creative Commons license link.
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

  // --- JSON-LD (Flickr embeds an ImageObject with name/author/license) ---
  let ld = {};
  try {
    const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const b of blocks) {
      let data;
      try { data = JSON.parse(b.textContent); } catch { continue; }
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        const type = node && node['@type'];
        if (type && /ImageObject|Photograph|CreativeWork/i.test(String(type))) { ld = node; break; }
        if (!ld.name && node && (node.name || node.author)) ld = node;
      }
      if (ld && (ld.name || ld.author)) break;
    }
  } catch { /* ignore */ }

  let ldAuthor = '';
  if (ld && ld.author) {
    if (typeof ld.author === 'string') ldAuthor = ld.author;
    else if (Array.isArray(ld.author)) ldAuthor = (ld.author[0] && ld.author[0].name) || '';
    else ldAuthor = ld.author.name || '';
  }

  // --- Title ---
  const title = bySelector(sel.title)
    || (ld && clean(ld.name))
    || metaContent('meta[property="og:title"]')
    || metaContent('meta[name="twitter:title"]')
    || clean((document.title || '').replace(/\s*\|\s*Flickr.*$/i, ''));

  // --- Description ---
  const description = bySelector(sel.description)
    || (ld && clean(ld.description))
    || metaContent('meta[property="og:description"]')
    || metaContent('meta[name="description"]');

  // --- Attribution (photographer) ---
  let attribution = bySelector(sel.attribution) || clean(ldAuthor) || metaContent('meta[name="author"]');
  if (!attribution) {
    const ownerSelectors = [
      '.owner-name', 'a.owner-name', '.attribution-info .owner-name',
      '.photo-attribution a', '[data-track="attributionOwnerName"]'
    ];
    for (const s of ownerSelectors) {
      const v = bySelector(s);
      if (v) { attribution = v; break; }
    }
  }
  if (!attribution) {
    const canon = document.querySelector('link[rel="canonical"]');
    const href = (canon && canon.getAttribute('href')) || location.href;
    const m = String(href || '').match(/flickr\.com\/photos\/([^/]+)/i);
    if (m) attribution = decodeURIComponent(m[1]);
  }

  // --- License (varies per photo — scrape it) ---
  let license = bySelector(sel.license);
  if (!license) {
    // Most specific paths first so e.g. "by-nc-sa" isn't matched as "by".
    const ccMap = [
      ['publicdomain/zero', 'CC0'],
      ['publicdomain/mark', 'Public Domain Mark'],
      ['licenses/by-nc-nd', 'CC BY-NC-ND'],
      ['licenses/by-nc-sa', 'CC BY-NC-SA'],
      ['licenses/by-nd', 'CC BY-ND'],
      ['licenses/by-nc', 'CC BY-NC'],
      ['licenses/by-sa', 'CC BY-SA'],
      ['licenses/by', 'CC BY']
    ];
    const ccHref = Array.from(document.querySelectorAll('a[href*="creativecommons.org"]'))
      .map((a) => a.getAttribute('href') || '')
      .find((h) => /creativecommons\.org/i.test(h));
    if (ccHref) {
      for (const [key, name] of ccMap) {
        if (ccHref.includes(key)) {
          let label = name;
          const ver = ccHref.match(/\/(\d\.\d)\//);
          if (ver && label.startsWith('CC BY')) label += ' ' + ver[1];
          license = label;
          break;
        }
      }
    }
  }
  if (!license && ld && typeof ld.license === 'string') {
    license = clean(ld.license);
  }
  if (!license) {
    const bodyText = document.body ? document.body.innerText : '';
    if (/all rights reserved/i.test(bodyText)) license = 'All Rights Reserved';
  }

  return { title, description, attribution, license };
}

async function scrapePageMetadata(contents) {
  if (!contents || contents.isDestroyed()) return {};
  const cfg = AppCtx.plugins[PLUGIN_NAME]?.config || {};
  const sel = {
    title: cfg.titleSelector || '',
    description: cfg.descriptionSelector || '',
    attribution: cfg.attributionSelector || '',
    license: cfg.licenseSelector || ''
  };
  const script = `(${pageScraper.toString()})(${JSON.stringify(sel)})`;
  try {
    return (await contents.executeJavaScript(script, true)) || {};
  } catch (err) {
    AppCtx.error('[flickr] Metadata scrape failed:', err.message);
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
  if (ses.__flickrDownloadHooked) return;
  ses.__flickrDownloadHooked = true;

  ses.on('will-download', (_event, item, webContents) => {
    const sourceUrl = item.getURL();
    const pageContents = webContents;
    let pageUrl = '';
    try { pageUrl = pageContents.getURL(); } catch { /* ignore */ }

    const suggested = item.getFilename() || 'flickr-download';
    const ext = pickExtension(suggested, sourceUrl, item);
    const safeBase = sanitize(stripExt(suggested)) || 'flickr-download';
    const tmpPath = path.join(os.tmpdir(), `flickr-${Date.now()}-${safeBase}${ext}`);
    item.setSavePath(tmpPath);

    AppCtx.log(`[flickr] Capturing download: ${suggested} (${sourceUrl})`);

    item.once('done', async (_e, state) => {
      if (state !== 'completed') {
        AppCtx.error(`[flickr] Download did not complete (${state}): ${sourceUrl}`);
        notifyPage(pageContents, `⚠ Download ${state}`, true);
        return;
      }

      try {
        const scraped = await scrapePageMetadata(pageContents);
        const title = scraped.title || stripExt(suggested) || safeBase;
        const metadata = {
          title,
          description: scraped.description || '',
          attribution: scraped.attribution || '',
          license: scraped.license || '',
          url_origin: pageUrl || '',
          url_library: pageUrl || '',
          url_direct: sourceUrl,
          original_filename: suggested
        };

        const result = await mediaLibrary.hashAndStore(tmpPath, metadata, AppCtx);
        const stored = result?.filename || 'media';
        AppCtx.log(`[flickr] Imported "${title}" → ${stored}` +
          (metadata.attribution ? ` (by ${metadata.attribution})` : '') +
          (metadata.license ? ` [${metadata.license}]` : ''));
        const licenseNote = metadata.license ? ` — ${metadata.license}` : '';
        notifyPage(pageContents, `✓ Imported “${title}”${licenseNote}`);
      } catch (err) {
        AppCtx.error('[flickr] Import failed:', err.message);
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
    title: 'Flickr',
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

  AppCtx.log(`[flickr] Opening embedded browser: ${START_URL}`);
  browserWindow.loadURL(START_URL);
}

// ---------------------------------------------------------------- plugin definition

const plugin = {
  priority: 92,
  version: '0.1.0',
  pluginButtons: [
    { title: '📷 Flickr', action: 'open-explorer' }
  ],
  configTemplate: [
    { name: 'titleSelector', type: 'string', description: 'Optional CSS selector for the photo title (leave blank to auto-detect)', default: '' },
    { name: 'descriptionSelector', type: 'string', description: 'Optional CSS selector for the description (leave blank to auto-detect)', default: '' },
    { name: 'attributionSelector', type: 'string', description: 'Optional CSS selector for the photographer/attribution (leave blank to auto-detect)', default: '' },
    { name: 'licenseSelector', type: 'string', description: 'Optional CSS selector for the license (leave blank to auto-detect)', default: '' }
  ],

  register(AppContext) {
    AppCtx = AppContext;
    AppContext.log('[flickr] Registered!');
  },

  api: {
    'open-explorer': async function () {
      try {
        openExplorer();
        return { success: true };
      } catch (err) {
        AppCtx.error('[flickr] open-explorer failed:', err.message);
        return { success: false, error: err.message };
      }
    }
  }
};

module.exports = plugin;
