const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { parseFrontMatter } = require('./frontMatter');
const { slugify } = require('./pathSafety');

// IPC: opened-presentation:get / :import / :dismiss (state pushed to the main window as
// 'opened-presentation:changed'). Menu callback: menu:open-presentation. main.js feeds it
// files from argv (findRevelFileInArgv), macOS open-file and second-instance via
// queue/handleOpenRequest/markReady/flushPending. Also exports isOpenSlug/assertWritableSlug,
// which write-capable handlers (createPresentation, presentationBuilderWindow, importPresentation)
// call to refuse edits to the transient slug. Extraction itself is importPresentation.runZipImport.
// Open/import behavior is documented in doc/dev/REVEL_IMPLEMENTATION.md; the file format itself
// is specified in doc/dev/REVEL_FORMAT.md.
//
// A .revel file opened from the OS (double-click, "Open with", drag onto the dock icon) is
// extracted into this fixed slug and treated as read-only until the user imports it.
// The name is deliberately not slugify()-safe, so a user-chosen slug can never collide with it.
const OPEN_SLUG = '_current_open';
const REVEL_EXTENSION = '.revel';

const state = {
  pendingFile: null, // queued before the app was ready to handle it
  ready: false,      // the main window has been shown at least once
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

// An argv entry as a filesystem path. Linux desktop entries use %U, so file managers may pass a
// file:// URL (percent-encoded) instead of a path. A relative path is relative to the directory
// the launching process ran in, which for a second instance is not our own working directory.
function argToPath(arg, cwd) {
  if (/^file:\/\//i.test(arg)) {
    try {
      return fileURLToPath(arg);
    } catch {
      return null;
    }
  }
  return path.resolve(cwd || process.cwd(), arg);
}

// Windows/Linux pass the file in argv; skip Chromium switches and the app path itself.
function findRevelFileInArgv(argv, cwd) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv.slice(1)) {
    if (typeof arg !== 'string' || arg.startsWith('--')) continue;
    const resolved = argToPath(arg, cwd);
    if (!resolved || !isRevelPath(resolved)) continue;
    try {
      if (fs.statSync(resolved).isFile()) return resolved;
    } catch {
      // not a readable file; keep looking
    }
  }
  return null;
}

function readFrontMatter(mdPath) {
  try {
    const text = fs.readFileSync(mdPath, 'utf-8');
    return parseFrontMatter(text).data;
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

function describeOpenPresentation(AppContext, sourceFile, importResult = {}) {
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
    existingSlug: findLibrarySlugById(AppContext.config.presentationsDir, presentationId),
    // Surfaced as notices in the lightbox: prohibited files left out, and a file from a newer release.
    skippedCount: Array.isArray(importResult.skipped) ? importResult.skipped.length : 0,
    newerVersion: importResult.newerVersion || null
  };
}

function notifyChanged(AppContext) {
  const win = AppContext.win;
  if (win && !win.isDestroyed()) {
    win.webContents.send('opened-presentation:changed', state.current);
  }
}

// Close every window showing the opened presentation (builder, slideshow, notes, handout), since
// its folder is about to be replaced, moved or deleted. The main window and hidden offscreen
// capture windows are left alone. Presentation windows are destroyed rather than closed so they
// skip their fade-to-black; their 'closed' handlers still run.
function closeWindowsShowingOpened(AppContext) {
  let BrowserWindow;
  try {
    ({ BrowserWindow } = require('electron'));
  } catch {
    return 0;
  }
  let closed = 0;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win === AppContext.win) continue;
    let url = '';
    try {
      if (win.webContents.isOffscreen && win.webContents.isOffscreen()) continue;
      url = win.webContents.getURL();
    } catch {
      continue;
    }
    if (url.includes(`/${OPEN_SLUG}/`) || url.includes(`slug=${OPEN_SLUG}`)) {
      win.destroy();
      closed += 1;
    }
  }
  return closed;
}

function removeOpenDir(AppContext) {
  const dir = path.join(AppContext.config.presentationsDir, OPEN_SLUG);
  fs.rmSync(dir, { recursive: true, force: true });
}

// Opens run one at a time: two requests arriving together (a double-click while another file is
// still extracting) would otherwise extract into the same folder at once and mix their contents.
let openQueueTail = Promise.resolve();
function openFile(AppContext, filePath) {
  const run = openQueueTail.then(() => openFileNow(AppContext, filePath));
  openQueueTail = run.catch(() => {});
  return run;
}

async function openFileNow(AppContext, filePath) {
  const { importPresentation } = require('./importPresentation');
  const resolved = path.resolve(filePath);
  if (!isRevelPath(resolved)) {
    return { success: false, error: 'Not a .revel file.' };
  }
  try {
    // Opening a file replaces the previous opened copy, so every window still showing it closes.
    require('./presentationBuilderWindow').presentationBuilderWindow.closeForSlug(OPEN_SLUG);
    closeWindowsShowingOpened(AppContext);
    const result = await importPresentation.runZipImport({ zipPath: resolved, slug: OPEN_SLUG }, AppContext);
    if (!result.success) {
      // The previous opened copy was already replaced, so the lightbox must not keep showing it.
      state.current = null;
      notifyChanged(AppContext);
      return result;
    }
    state.current = describeOpenPresentation(AppContext, resolved, result);
    AppContext.log(`📂 Opened ${resolved} read-only as ${OPEN_SLUG}`);
    notifyChanged(AppContext);
    const win = AppContext.win;
    // Bring the app forward. Before the window has been shown, the startup hand-off does it, so
    // the window does not appear ahead of the splash screen.
    if (win && !win.isDestroyed() && state.ready) {
      if (win.isMinimized()) win.restore();
      win.show();
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

// Windows can report EBUSY/EPERM for a moment after a window closes while handles are released.
function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return fs.renameSync(from, to);
    } catch (err) {
      if (!['EBUSY', 'EPERM'].includes(err.code) || attempt >= 5) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * (attempt + 1));
    }
  }
}

// Move the opened presentation into the library under a normal, unique slug.
function importOpened(AppContext, { builderCloser } = {}) {
  const current = state.current;
  if (!current) throw new Error('No opened presentation to import.');
  const root = path.resolve(AppContext.config.presentationsDir);
  const from = path.join(root, OPEN_SLUG);
  if (!fs.existsSync(from)) throw new Error('The opened presentation is no longer available.');

  const baseSlug = slugify(path.basename(current.sourceName, path.extname(current.sourceName))) || 'presentation';
  let slug = baseSlug;
  for (let n = 2; fs.existsSync(path.join(root, slug)); n += 1) {
    slug = `${baseSlug}-${n}`;
  }
  if (typeof builderCloser === 'function') builderCloser();
  // The slideshow, notes and handout windows load from the old folder; close them before the
  // rename (an open file handle would block it on Windows).
  closeWindowsShowingOpened(AppContext);
  renameWithRetry(from, path.join(root, slug));
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
      if (!result.success && !result.canceled) dialog.showErrorBox('Open Presentation', result.error || 'The file could not be opened.');
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
      closeWindowsShowingOpened(AppContext);
      dismissOpened(AppContext);
      return { success: true };
    });
  },

  // Queue a file until startup has finished (macOS open-file can fire before ready). There is one slot,
  // so a later file replaces an earlier one; the argv path (findRevelFileInArgv) keeps the first instead.
  queue(filePath) {
    if (isRevelPath(filePath)) state.pendingFile = path.resolve(filePath);
  },

  // A file arrived from the OS (second instance, or macOS open-file). Open it now if the app is
  // up, otherwise it waits in the queue for startup to flush it.
  handleOpenRequest(AppContext, filePath) {
    this.queue(filePath);
    if (state.ready) return this.flushPending(AppContext);
    return undefined;
  },

  // The main window has been shown: from now on files open and bring the app forward immediately.
  markReady(AppContext) {
    state.ready = true;
    return this.flushPending(AppContext);
  },

  isReady() {
    return state.ready;
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
