const { BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml'); 
const { exportSlidesAsImages } = require('./exportWindow');

const templateDir = path.join('templates','default');
const NOTE_VERSION_BREAKPOINT = [0, 2, 6];

function normalizeNoteSeparators(markdown = '') {
  return String(markdown)
    .split(/\r?\n/)
    .map((line) => (line.trim() === 'Note:' ? ':note:' : line))
    .join('\n');
}

function parseSemverTuple(version) {
  const raw = String(version || '').trim();
  const match = raw.match(/^v?(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersionTuples(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  for (let i = 0; i < 3; i += 1) {
    const av = Number(a[i] || 0);
    const bv = Number(b[i] || 0);
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function isLegacyNoteVersion(version) {
  const tuple = parseSemverTuple(version);
  if (!tuple) return true;
  return compareVersionTuples(tuple, NOTE_VERSION_BREAKPOINT) <= 0;
}

function isNewNoteVersion(version) {
  const tuple = parseSemverTuple(version);
  if (!tuple) return false;
  return compareVersionTuples(tuple, NOTE_VERSION_BREAKPOINT) > 0;
}

const touch = (filePath) => {
  const time = new Date();
  fs.utimesSync(filePath, time, time);
};

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

function randomFourDigits() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

const createPresentation = {
  register(ipcMain, AppContext) {
    
    AppContext.callbacks['menu:new-presentation'] = () => this.open(AppContext);

    // IPC Handler to create Presentation File using Data
    ipcMain.handle('create-presentation', async (_event, data) => {
      try {
        const result = await this.run(data, AppContext);
        return result;
      } catch (err) {
        throw new Error(err.message); // Sends to renderer via rejected promise
      }
    });
    
    // IPC Handler to edit metadata
    ipcMain.handle('edit-presentation-metadata', async (_event, slug, mdFile) => {
      this.open(AppContext, slug, mdFile);
    });

    ipcMain.handle('save-presentation-metadata', async (_event, slug, mdFile, data) => {
      try {
        const result = await this.run(data, AppContext, slug, mdFile);
        return result;
      } catch (err) {
        throw new Error(err.message); // Sends to renderer via rejected promise
      }
    });
  },

  // Open the create presentation window
  open(AppContext, slug = null, mdFile = null) {
    const createWin = new BrowserWindow({
      width: 800,
      height: 900,
      webPreferences: {
        preload: AppContext.preload,
      },
    });
    //createWin.webContents.openDevTools()  // Uncomment for debugging
    createWin.setMenu(null); // 🚫 Remove the menu bar
    const url = slug && mdFile ? `/admin/edit-metadata.html?dir=presentations_${AppContext.config.key}&slug=${slug}&md=${mdFile}` : '/admin/create.html';
    createWin.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}${url}`);
  },

  async run(data, AppContext, userSlug = null, userMDFile = null) {
    const presentationsDir = AppContext.config.presentationsDir;
    let mdBody = '';
    let slug = userSlug;
    let mdFile = userMDFile;
    let existingVersion = null;

    if(slug && mdFile) {
      // Editing existing presentation metadata
      const fullPath = path.join(presentationsDir, slug, mdFile);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Presentation file '${mdFile}' does not exist in '${slug}'`);
      }
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
      if (match) {
        try {
          const parsed = yaml.load(match[1]);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            existingVersion = parsed.version ?? null;
          }
        } catch {
          existingVersion = null;
        }
      }
      mdBody = match ? raw.slice(match[0].length) : raw;
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
        mdBody = data.createTitleSlide ? `\n# ${title}\n\n${data.description || ''}\n\n***\n\n` : `\n\n`;
    }
    const presDir = path.join(presentationsDir, slug);

    const metadata = {
      ...data,
      version: app.getVersion()
    };
    
    // remove createTitleSlide from metadata
    delete metadata.createTitleSlide;
    // slug controls folder naming and is not YAML front matter metadata.
    delete metadata.slug;

    if(!userSlug && !userMDFile) {
      // Check if slug already exists
      if (fs.existsSync(presDir)) {
        throw new Error(`Presentation folder '${slug}' already exists.`);
      }

      fs.mkdirSync(presDir, { recursive: true });

      // Copy template assets
      fs.copyFileSync(path.join(AppContext.config.revelationDir,templateDir, 'style.css'), path.join(presDir, 'style.css'));
      fs.copyFileSync(path.join(AppContext.config.revelationDir,templateDir, 'thumbnail.jpg'), path.join(presDir, 'thumbnail.jpg'));
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
      try {
        await exportSlidesAsImages(AppContext, slug, mdFile, 853, 480, 2, true);
      } catch (err) {
        AppContext.error(`Thumbnail generation failed for ${slug}: ${err.message}`);
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
