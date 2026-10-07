/**
 * createPresentation.js -- "New Presentation" and "Edit Metadata" window plus the file creation logic.
 * Window: 1100x1000 (clamped to the display's work area), preload.js, loads /admin/create.html or /admin/edit-metadata.html (Vite).
 * IPC: open-new-presentation, create-presentation, edit-presentation-metadata, save-presentation-metadata,
 * plus read/save-presentation-style (registered from presentationStyle.js).
 * Menu callback: menu:new-presentation. run() writes <presentationsDir>/<slug>/presentation.md (front matter +
 * body) from the revelation default template, then renders a thumbnail through exportWindow.exportSlidesAsImages
 * unless data.skipThumbnail (set by http_admin/import-presentation.js, which adds slides before rendering the thumbnail).
 * Required by main.js. NOTE: the note-separator / semver helpers below and deriveThumbnailName are copied in
 * presentationBuilderWindow.js (and deriveThumbnailName in exportWindow.js).
 */

const { BrowserWindow, app, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { resolvePresentationDir, resolvePresentationFile, slugify } = require('./pathSafety');
const yaml = require('js-yaml');
const { parseFrontMatter } = require('./frontMatter');
const { exportSlidesAsImages } = require('./exportWindow');
const { buildServerURL } = require('./serverUrl');
const presentationStyle = require('./presentationStyle');
const { assertWritableSlug } = require('./openedPresentation');
const { isLegacyNoteVersion, isNewNoteVersion, normalizeNoteSeparators } = require('./versionUtil');

const templateDir = path.join('templates','default');
const touch = (filePath) => {
  const time = new Date();
  fs.utimesSync(filePath, time, time);
};

function deriveThumbnailName(mdFile) {
  const basename = path.basename(mdFile, path.extname(mdFile));
  return `${basename}.thumb.jpg`;
}

function randomFourDigits() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

const createPresentation = {
  register(ipcMain, AppContext) {
    
    AppContext.callbacks['menu:new-presentation'] = () => this.open(AppContext);

    // IPC Handler to open the New Presentation window (same as menu action)
    ipcMain.handle('open-new-presentation', () => {
      this.open(AppContext);
    });

    // IPC Handler to create Presentation File using Data
    ipcMain.handle('create-presentation', async (_event, data) => {
      return this.run(data, AppContext);
    });
    
    // IPC Handler to edit metadata
    ipcMain.handle('edit-presentation-metadata', async (_event, slug, mdFile) => {
      this.open(AppContext, slug, mdFile);
    });

    ipcMain.handle('save-presentation-metadata', async (_event, slug, mdFile, data) => {
      assertWritableSlug(slug);
      return this.run(data, AppContext, slug, mdFile);
    });

    // Style tab of the Edit Metadata window: read/write the presentation's custom stylesheet.
    presentationStyle.register(ipcMain, AppContext);
  },

  // Open the create presentation window
  open(AppContext, slug = null, mdFile = null) {
    const { width: workW, height: workH } = screen.getPrimaryDisplay().workAreaSize;
    const createWin = new BrowserWindow({
      width: Math.min(1100, workW),
      height: Math.min(1000, workH),
      webPreferences: {
        preload: AppContext.preload,
      },
    });
    //createWin.webContents.openDevTools()  // Uncomment for debugging
    createWin.setMenu(null); // 🚫 Remove the menu bar
    const url = slug && mdFile ? `/admin/edit-metadata.html?dir=presentations_${AppContext.config.key}&slug=${slug}&md=${mdFile}` : '/admin/create.html';
    const baseURL = buildServerURL(AppContext.hostURL, AppContext.config.viteServerPort, AppContext.config.httpsEnabled);
    createWin.loadURL(`${baseURL}${url}`);
  },

  async run(data, AppContext, userSlug = null, userMDFile = null) {
    const presentationsDir = AppContext.config.presentationsDir;
    let mdBody = '';
    let slug = userSlug;
    let mdFile = userMDFile;
    let existingVersion = null;

    if(slug && mdFile) {
      // Editing existing presentation metadata
      const fullPath = resolvePresentationFile(presentationsDir, slug, mdFile);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Presentation file '${mdFile}' does not exist in '${slug}'`);
      }
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const parsedFrontMatter = parseFrontMatter(raw);
      existingVersion = parsedFrontMatter.data.version ?? null;
      mdBody = parsedFrontMatter.body;
    }
    else {
        const title = data.title || 'Untitled';
        const requestedSlugRaw = String(data.slug || '').trim();
        const requestedSlug = slugify(requestedSlugRaw);
        if (requestedSlugRaw && !requestedSlug) {
          throw new Error('Presentation slug is invalid.');
        }
        slug = requestedSlug || `${slugify(title) || 'presentation'}-${randomFourDigits()}`;
        mdFile = 'presentation.md'
        mdBody = data.createTitleSlide ? `\n# ${title}\n\n${data.description || ''}\n\n` : `\n\n`;
    }
    const presDir = resolvePresentationDir(presentationsDir, slug);

    const metadata = {
      ...data,
      version: app.getVersion()
    };

    // remove createTitleSlide from metadata
    delete metadata.createTitleSlide;
    // skipThumbnail: caller adds slides first and renders the thumbnail itself (e.g. PDF import).
    const skipThumbnail = !!metadata.skipThumbnail;
    delete metadata.skipThumbnail;
    // slug controls folder naming and is not YAML front matter metadata.
    delete metadata.slug;

    // Remove thumbnail if it matches the derived default
    const derivedThumbnail = deriveThumbnailName(mdFile);
    if (metadata.thumbnail === derivedThumbnail) {
      delete metadata.thumbnail;
    }

    if(!userSlug && !userMDFile) {
      // Check if slug already exists
      if (fs.existsSync(presDir)) {
        throw new Error(`Presentation folder '${slug}' already exists.`);
      }

      fs.mkdirSync(presDir, { recursive: true });

      // Copy template assets
      fs.copyFileSync(path.join(AppContext.config.revelationDir,templateDir, 'style.css'), path.join(presDir, 'style.css'));

      // Copy template thumbnail with derived name
      const derivedThumbnailName = deriveThumbnailName(mdFile);
      fs.copyFileSync(path.join(AppContext.config.revelationDir,templateDir, 'thumbnail.jpg'), path.join(presDir, derivedThumbnailName));

      metadata['created'] = new Date().toISOString().split('T')[0];
    }

    // Format YAML frontmatter safely
    const frontmatter = `---\n${yaml.dump(metadata)}---\n`;

    const shouldNormalizeNotes =
      !!(userSlug && userMDFile) &&
      isLegacyNoteVersion(existingVersion) &&
      isNewNoteVersion(metadata.version);
    const normalizedBody = shouldNormalizeNotes ? normalizeNoteSeparators(mdBody) : mdBody;
    fs.writeFileSync(path.join(presDir, mdFile), frontmatter + normalizedBody, 'utf-8');

    if(!userSlug && !userMDFile) {
      if (!skipThumbnail) {
        try {
          await exportSlidesAsImages(AppContext, slug, mdFile, 853, 480, 2, true);
        } catch (err) {
          AppContext.error(`Thumbnail generation failed for ${slug}: ${err.message}`);
        }
      }
      if (AppContext.win && !AppContext.win.isDestroyed()) {
        AppContext.win.webContents.reloadIgnoringCache();
      }
    }

    return {
      success: true,
      message: `✅ Presentation saved in ${presentationsDir}/${slug}/${mdFile}`,
      slug
    };
  }
}

module.exports = { createPresentation };
