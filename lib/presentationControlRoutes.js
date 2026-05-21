const { presentationWindow } = require('./presentationWindow');
const fs = require('fs');
const path = require('path');

const ACTIONS = {
  next:     { key: ' ',          code: 'Space',     keyCode: 32 },
  prev:     { key: 'p',          code: 'KeyP',      keyCode: 80 },
  up:       { key: 'ArrowUp',    code: 'ArrowUp',   keyCode: 38 },
  down:     { key: 'ArrowDown',  code: 'ArrowDown', keyCode: 40 },
  left:     { key: 'ArrowLeft',  code: 'ArrowLeft', keyCode: 37 },
  right:    { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  blank:    { key: 'b',          code: 'KeyB',      keyCode: 66 },
  overview: { key: 'o',          code: 'KeyO',      keyCode: 79 },
  push:     { key: 'z',          code: 'KeyZ',      keyCode: 90 },
  close:    { key: 'q',          code: 'KeyQ',      keyCode: 81 },
};

function register(routes, AppContext) {
  routes['POST /api/presentation/control'] = async (params, res, body) => {
    const action = body?.action;
    const binding = ACTIONS[action];
    if (!binding) throw { status: 400, message: `Unknown action: ${action}` };

    const pres = presentationWindow.presWindow;
    if (!pres || pres.isDestroyed()) {
      throw { status: 409, message: 'No active presentation' };
    }

    // Special handling for actions that need direct method calls instead of simulated keys
    if (action === 'overview') {
      await pres.webContents.executeJavaScript('window.deck && window.deck.toggleOverview?.()');
    } else if (action === 'blank') {
      await pres.webContents.executeJavaScript('window.deck && window.deck.togglePause?.()');
    } else {
      // Standard key simulation for navigation actions
      presentationWindow.sendKeyToPresentation(binding, AppContext);
    }

    return { action };
  };

  routes['GET /api/presentation/status'] = async (params, res, body) => {
    const pres = presentationWindow.presWindow;

    if (!pres || pres.isDestroyed()) {
      return { isOpen: false };
    }

    try {
      const url = pres.webContents.getURL();
      const urlObj = new URL(url);

      // Parse slug from path: /presentations_key/slug/index.html
      const pathMatch = urlObj.pathname.match(/\/presentations_[^/]+\/([^/]+)\/index\.html/);
      const slug = pathMatch?.[1] || null;

      // Parse mdFile from query param
      const mdFile = urlObj.searchParams.get('p') || null;

      // Query Reveal.js for current state
      const stateScript = `
        (function() {
          const deck = window.deck;
          return deck ? deck.getState?.() : null;
        })()
      `;

      const state = await pres.webContents.executeJavaScript(stateScript);

      // deck.getState() returns: { indexh, indexv, paused, overview }
      const indexh = typeof state?.indexh === 'number' ? state.indexh : 0;
      const indexv = typeof state?.indexv === 'number' ? state.indexv : 0;
      const isBlank = state?.paused === true;
      const isOverview = state?.overview === true;

      return {
        isOpen: true,
        slug,
        mdFile,
        slideNumber: {
          h: indexh + 1,
          v: indexv + 1
        },
        isBlank,
        isOverview
      };
    } catch (err) {
      AppContext?.error?.(`[api] Error querying presentation status: ${err.message}`);
      return {
        isOpen: true,
        slug: null,
        mdFile: null,
        slideNumber: null,
        isBlank: null,
        isOverview: null,
        error: 'Failed to query presentation state'
      };
    }
  };

  routes['POST /api/presentation/goto'] = async (params, res, body) => {
    const h = body?.h;
    const v = body?.v;

    if (typeof h !== 'number' || typeof v !== 'number') {
      throw { status: 400, message: 'Missing or invalid parameters: h and v must be numbers' };
    }

    if (h < 1 || v < 1) {
      throw { status: 400, message: 'Invalid slide number: h and v must be >= 1' };
    }

    const pres = presentationWindow.presWindow;
    if (!pres || pres.isDestroyed()) {
      throw { status: 409, message: 'No active presentation' };
    }

    // Convert from 1-based (user-facing) to 0-based (Reveal.js internal)
    const indexh = h - 1;
    const indexv = v - 1;

    try {
      await pres.webContents.executeJavaScript(`window.deck && window.deck.slide(${indexh}, ${indexv})`);
      return { h, v, indexh, indexv };
    } catch (err) {
      AppContext?.error?.(`[api] Failed to navigate to slide: ${err.message}`);
      throw { status: 500, message: 'Failed to navigate to slide' };
    }
  };

  routes['POST /api/presentation/open'] = async (params, res, body) => {
    const slug = body?.slug;
    if (!slug) throw { status: 400, message: 'Missing required parameter: slug' };

    const mdFile = body?.mdFile;
    if (!mdFile) throw { status: 400, message: 'Missing required parameter: mdFile (external URLs not allowed)' };

    // Prevent path traversal attacks
    if (slug.includes('/')) throw { status: 400, message: 'Invalid slug: cannot contain path separators' };
    if (mdFile.includes('..')) throw { status: 400, message: 'Invalid mdFile: cannot contain parent directory references' };

    const fullscreen = body?.fullscreen !== false;
    const overrides = body?.overrides || {};

    // Validate local presentation exists
    const presentationsDir = AppContext.config.presentationsDir;
    if (!presentationsDir) {
      throw { status: 500, message: 'Presentations directory not configured' };
    }

    const presPath = path.join(presentationsDir, slug);
    const mdPath = path.join(presPath, mdFile);

    if (!fs.existsSync(presPath)) {
      throw { status: 404, message: `Presentation not found: ${slug}` };
    }

    if (!fs.existsSync(mdPath)) {
      throw { status: 404, message: `Markdown file not found: ${slug}/${mdFile}` };
    }

    AppContext.log(`[api] Opening presentation: slug=${slug}, mdFile=${mdFile}, fullscreen=${fullscreen}`);
    await presentationWindow.openWindow(AppContext, slug, mdFile, fullscreen, overrides);
    return { slug, mdFile, fullscreen };
  };
}

module.exports = { register };
