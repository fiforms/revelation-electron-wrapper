const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml'); 

const templateDir = path.join('templates','default');

const touch = (filePath) => {
  const time = new Date();
  fs.utimesSync(filePath, time, time);
};

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

const createPresentation = {
  register(ipcMain, AppContext) {
    
    AppContext.callbacks['menu:new-presentation'] = () => this.open(AppContext);

    // IPC Handler to create Presentation File using Data
    ipcMain.handle('create-presentation', async (_event, data) => {
      try {
        const result = this.run(data, AppContext);
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
        const result = this.run(data, AppContext, slug, mdFile);
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

  run(data, AppContext, userSlug = null, userMDFile = null) {
    const presentationsDir = AppContext.config.presentationsDir;
    let mdBody = '';
    let slug = userSlug;
    let mdFile = userMDFile;

    if(slug && mdFile) {
      // Editing existing presentation metadata
      const fullPath = path.join(presentationsDir, slug, mdFile);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Presentation file '${mdFile}' does not exist in '${slug}'`);
      }
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
      mdBody = match ? raw.slice(match[0].length) : raw;
    }
    else {
        const title = data.title || 'Untitled';
        slug = slugify(title);
        mdFile = 'presentation.md'
        mdBody = `\n# ${title}\n\n${data.description || ''}\n\n***\n\n`;
    }
    const presDir = path.join(presentationsDir, slug);

    const metadata = {
      ...data,
    };

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

    fs.writeFileSync(path.join(presDir, mdFile), frontmatter + mdBody, 'utf-8');

    return {
      success: true,
      message: `✅ Presentation saved in ${presentationsDir}/${slug}/${mdFile}`,
      slug
    };
  }
}

module.exports = { createPresentation };

