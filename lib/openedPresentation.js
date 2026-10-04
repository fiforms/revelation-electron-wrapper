const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// A .revel file opened from the OS (double-click, "Open with", drag onto the dock icon) is
// extracted into this fixed slug and treated as read-only until the user imports it.
// The name is deliberately not slugify()-safe, so a user-chosen slug can never collide with it.
const OPEN_SLUG = '_current_open';
const REVEL_EXTENSION = '.revel';

const state = {
  pendingFile: null, // queued before the app was ready to handle it
  current: null      // metadata for the presentation currently open, or null
};

function isOpenSlug(slug) {
  return String(slug || '') === OPEN_SLUG;
}

// Throws for the opened-file slug. Call at the top of any handler that writes to a presentation.
function assertWritableSlug(slug) {
  if (isOpenSlug(path.basename(String(slug || '')))) {
    throw new Error('This presentation was opened from a file and is read-only. Import it into your library to edit it.');
  }
}

function isRevelPath(value) {
  return typeof value === 'string' && value.toLowerCase().endsWith(REVEL_EXTENSION);
}

// Windows/Linux pass the file in argv; skip Chromium switches and the app path itself.
function findRevelFileInArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv.slice(1)) {
    if (typeof arg !== 'string' || arg.startsWith('--')) continue;
    if (!isRevelPath(arg)) continue;
    try {
      if (fs.statSync(arg).isFile()) return path.resolve(arg);
    } catch {
      // not a readable file; keep looking
    }
  }
  return null;
}

function readFrontMatter(mdPath) {
  try {
    const text = fs.readFileSync(mdPath, 'utf-8');
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const data = match ? yaml.load(match[1]) : null;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function pickMarkdownFile(presDir) {
  const files = fs.readdirSync(presDir)
    .filter((f) => f.toLowerCase().endsWith('.md') && !f.startsWith('.') && f !== '__builder_temp.md')
    .sort();
  if (files.includes('presentation.md')) return 'presentation.md';
  return files[0] || null;
}

function readPresentationId(presDir) {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(presDir, 'manifest.json'), 'utf-8')).presentationId || '');
  } catch {
    return '';
  }
}

// If the library already holds a presentation with this presentationId, return its slug.
function findLibrarySlugById(presentationsDir, presentationId) {
  if (!presentationId) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(presentationsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || isOpenSlug(entry.name)) continue;
    if (readPresentationId(path.join(presentationsDir, entry.name)) === presentationId) return entry.name;
  }
  return null;
}

function describeOpenPresentation(AppContext, sourceFile) {
  const presDir = path.join(AppContext.config.presentationsDir, OPEN_SLUG);
  const mdFile = pickMarkdownFile(presDir);
  if (!mdFile) {
    throw new Error('The file does not contain a presentation (no markdown file found).');
  }
  const meta = readFrontMatter(path.join(presDir, mdFile));
  const presentationId = readPresentationId(presDir);
  const base = path.basename(mdFile, path.extname(mdFile));
  return {
    slug: OPEN_SLUG,
    md: mdFile,
    title: String(meta.title || path.basename(sourceFile, path.extname(sourceFile))),
    description: String(meta.description || ''),
    thumbnail: String(meta.thumbnail || `${base}.thumb.jpg`),
    sourceFile,
    sourceName: path.basename(sourceFile),
    presentationId,
    existingSlug: findLibrarySlugById(AppContext.config.presentationsDir, presentationId)
  };
}

function notifyChanged(AppContext) {
  const win = AppContext.win;
  if (win && !win.isDestroyed()) {
    win.webContents.send('opened-presentation:changed', state.current);
  }
}

function removeOpenDir(AppContext) {
  const dir = path.join(AppContext.config.presentationsDir, OPEN_SLUG);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function openFile(AppContext, filePath) {
  const { importPresentation } = require('./importPresentation');
  const resolved = path.resolve(filePath);
  if (!isRevelPath(resolved)) {
    return { success: false, error: 'Not a .revel file.' };
  }
  try {
    const result = await importPresentation.runZipImport({ zipPath: resolved, slug: OPEN_SLUG }, AppContext);
    if (!result.success) return result;
    state.current = describeOpenPresentation(AppContext, resolved);
    AppContext.log(`📂 Opened ${resolved} read-only as ${OPEN_SLUG}`);
    notifyChanged(AppContext);
    const win = AppContext.win;
    // While still hidden behind the splash, the startup hand-off shows the window.
    if (win && !win.isDestroyed() && win.isVisible()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    return { success: true, opened: state.current };
  } catch (err) {
    AppContext.error('❌ Failed to open .revel file:', err.message);
    removeOpenDir(AppContext);
    state.current = null;
    notifyChanged(AppContext);
    return { success: false, error: err.message };
  }
}

// Move the opened presentation into the library under a normal, unique slug.
function importOpened(AppContext, { builderCloser } = {}) {
  const current = state.current;
  if (!current) throw new Error('No opened presentation to import.');
  const root = path.resolve(AppContext.config.presentationsDir);
  const from = path.join(root, OPEN_SLUG);
  if (!fs.existsSync(from)) throw new Error('The opened presentation is no longer available.');

  const baseSlug = String(path.basename(current.sourceName, path.extname(current.sourceName)))
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'presentation';
  let slug = baseSlug;
  for (let n = 2; fs.existsSync(path.join(root, slug)); n += 1) {
    slug = `${baseSlug}-${n}`;
  }
  if (typeof builderCloser === 'function') builderCloser();
  fs.renameSync(from, path.join(root, slug));
  AppContext.log(`📥 Imported opened presentation as ${slug}`);

  const imported = { slug, md: current.md };
  state.current = null;
  notifyChanged(AppContext);
  const indexPath = path.join(root, 'index.json');
  if (fs.existsSync(indexPath)) {
    const now = new Date();
    fs.utimesSync(indexPath, now, now);
  }
  return imported;
}

function dismissOpened(AppContext) {
  removeOpenDir(AppContext);
  state.current = null;
  notifyChanged(AppContext);
}

// A stale opened copy from a previous run (crash, or quit while a file was open) is never kept.
function cleanupOnStartup(AppContext) {
  try {
    removeOpenDir(AppContext);
  } catch (err) {
    AppContext.log(`⚠️ Could not clean ${OPEN_SLUG}: ${err.message}`);
  }
}

const openedPresentation = {
  OPEN_SLUG,

  register(ipcMain, AppContext) {
    ipcMain.handle('opened-presentation:get', () => state.current);

    // Presentation > Open Presentation: pick a .revel file, then take the same path as a
    // file-association open.
    AppContext.callbacks['menu:open-presentation'] = async () => {
      const { dialog } = require('electron');
      const parent = AppContext.win && !AppContext.win.isDestroyed() ? AppContext.win : undefined;
      const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
        title: 'Open Presentation',
        filters: [{ name: 'REVELation Presentation', extensions: ['revel'] }],
        properties: ['openFile']
      });
      if (canceled || !filePaths.length) return;
      const result = await openFile(AppContext, filePaths[0]);
      if (!result.success) dialog.showErrorBox('Open Presentation', result.error || 'The file could not be opened.');
    };

    ipcMain.handle('opened-presentation:import', () => {
      try {
        const { presentationBuilderWindow } = require('./presentationBuilderWindow');
        let builderWasOpen = false;
        const imported = importOpened(AppContext, {
          builderCloser: () => { builderWasOpen = !!presentationBuilderWindow.closeForSlug(OPEN_SLUG); }
        });
        // Continue editing in the builder under the new slug, now writable.
        if (builderWasOpen) {
          setImmediate(() => presentationBuilderWindow.open(AppContext, imported.slug, imported.md));
        }
        return { success: true, ...imported };
      } catch (err) {
        AppContext.error('❌ Import of opened presentation failed:', err.message);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('opened-presentation:dismiss', () => {
      const { presentationBuilderWindow } = require('./presentationBuilderWindow');
      presentationBuilderWindow.closeForSlug?.(OPEN_SLUG);
      dismissOpened(AppContext);
      return { success: true };
    });
  },

  // Queue a file until startup has finished (macOS open-file can fire before ready).
  queue(filePath) {
    if (isRevelPath(filePath)) state.pendingFile = path.resolve(filePath);
  },

  async flushPending(AppContext) {
    const file = state.pendingFile;
    state.pendingFile = null;
    if (file) await openFile(AppContext, file);
  },

  cleanupOnStartup,
  openFile,
  findRevelFileInArgv,
  isOpenSlug,
  assertWritableSlug
};

module.exports = { openedPresentation, OPEN_SLUG, isOpenSlug, assertWritableSlug };
