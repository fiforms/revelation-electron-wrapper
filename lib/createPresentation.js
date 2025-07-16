const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml'); 

const templateDir = path.resolve(__dirname, '../revelation/templates/default');

const touch = (filePath) => {
  const time = new Date();
  fs.utimesSync(filePath, time, time);
};

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

const createPresentation = {
  register(ipcMain, AppContext) {
    ipcMain.handle('create-presentation', async (_event, data) => {
      // FIXME: This function never fires.
      try {
        const result = this.run(data, AppContext);
        return result;
      } catch (err) {
        throw new Error(err.message); // Sends to renderer via rejected promise
      }
    });
  },

  // Open the create presentation window
  open(AppContext) {
    const createWin = new BrowserWindow({
      width: 600,
      height: 500,
      webPreferences: {
        preload: path.join(AppContext.preload),
      },
    });
  
    createWin.setMenu(null); // 🚫 Remove the menu bar
    createWin.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/admin/create.html`);
  },

  run(data, AppContext) {
    const presentationsDir = AppContext.config.revelationDir + '/presentations_' + AppContext.getPresentationKey()
    const title = data.title || 'Untitled';
    const slug = slugify(title);
    const presDir = path.join(presentationsDir, slug);

    if (fs.existsSync(presDir)) {
      throw new Error(`Presentation folder '${slug}' already exists.`);
    }

    fs.mkdirSync(presDir, { recursive: true });

    // Copy template assets
    fs.copyFileSync(path.join(templateDir, 'style.css'), path.join(presDir, 'style.css'));
    fs.copyFileSync(path.join(templateDir, 'thumbnail.webp'), path.join(presDir, 'thumbnail.webp'));

    // Compose full YAML
    const date = new Date().toISOString().split('T')[0];
    const metadata = {
      ...data,
      created: date,
      theme: data.theme || 'softblood.css',
      thumbnail: data.thumbnail || 'thumbnail.webp'
    };

    // Format YAML frontmatter safely
    const frontmatter = `---\n${yaml.dump(metadata)}---\n`;

    // Basic slide content
    const mdBody = `\n# ${title}\n\n${data.description || ''}\n`;

    fs.writeFileSync(path.join(presDir, 'presentation.md'), frontmatter + mdBody, 'utf-8');

    // Trigger Vite refresh if applicable
    const dummy = path.join(presentationsDir, 'index.json');
    if (fs.existsSync(dummy)) touch(dummy);

    return {
      success: true,
      message: `✅ Presentation '${title}' created in presentations/${slug}`,
      slug
    };
  }
}

module.exports = { createPresentation };

