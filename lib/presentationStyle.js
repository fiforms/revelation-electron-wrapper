/**
 * presentationStyle.js -- read and write a presentation's custom stylesheet for the Style tab of the
 * Edit Metadata window (http_admin/create/tab-style.js).
 * IPC: read-presentation-style(slug, cssFile) -> text ('' when the file does not exist),
 *      save-presentation-style(slug, cssFile, css) -> { success, message }.
 * cssFile is the `stylesheet` front-matter value (default 'style.css'). It comes from the renderer, so it is
 * confined to the presentation folder, must end in .css and must not be a URL. The renderer merges its
 * generated block into the text (http_admin/create/style-block.js); this file only moves bytes.
 * Required by main.js (via createPresentation.register).
 */
const fs = require('fs');
const path = require('path');
const { resolvePresentationFile } = require('./pathSafety');
const { assertWritableSlug } = require('./openedPresentation');

const DEFAULT_STYLESHEET = 'style.css';
const MAX_CSS_BYTES = 1024 * 1024;

// Resolve <presentationsDir>/<slug>/<cssFile>, throwing for anything that is not a .css file inside the folder.
function resolveStylePath(presentationsDir, slug, cssFile) {
  const name = String(cssFile || DEFAULT_STYLESHEET).trim() || DEFAULT_STYLESHEET;
  if (/^[a-z][a-z0-9+.-]*:/i.test(name)) throw new Error(`Stylesheet must be a file in the presentation folder: ${name.slice(0, 80)}`);
  if (!name.toLowerCase().endsWith('.css')) throw new Error('Stylesheet file name must end in .css');
  return resolvePresentationFile(presentationsDir, slug, name);
}

function readStyle(presentationsDir, slug, cssFile) {
  const file = resolveStylePath(presentationsDir, slug, cssFile);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
}

function writeStyle(presentationsDir, slug, cssFile, css) {
  if (typeof css !== 'string') throw new Error('Stylesheet text must be a string');
  if (Buffer.byteLength(css, 'utf-8') > MAX_CSS_BYTES) throw new Error('Stylesheet is too large');
  const file = resolveStylePath(presentationsDir, slug, cssFile);
  if (!fs.existsSync(path.dirname(file))) throw new Error(`Presentation folder not found: ${slug}`);
  fs.writeFileSync(file, css, 'utf-8');
  return file;
}

const presentationStyle = {
  register(ipcMain, AppContext) {
    ipcMain.handle('read-presentation-style', async (_event, slug, cssFile) => {
      return readStyle(AppContext.config.presentationsDir, slug, cssFile);
    });

    ipcMain.handle('save-presentation-style', async (_event, slug, cssFile, css) => {
      assertWritableSlug(slug);
      writeStyle(AppContext.config.presentationsDir, slug, cssFile, css);
      return { success: true, message: 'Style saved.' };
    });
  },
  resolveStylePath,
  readStyle,
  writeStyle
};

module.exports = presentationStyle;
