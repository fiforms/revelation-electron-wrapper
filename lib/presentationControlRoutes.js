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

    if (!presentationWindow.presWindow || presentationWindow.presWindow.isDestroyed()) {
      throw { status: 409, message: 'No active presentation' };
    }

    presentationWindow.sendKeyToPresentation(binding, AppContext);
    return { action };
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
