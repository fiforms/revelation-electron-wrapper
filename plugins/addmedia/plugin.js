
// plugins/addmedia/plugin.js

const { dialog, app } = require('electron');
const fs = require('fs');
const path = require('path');
let AppCtx = null;
const mediaLibPath = path.join(app.getAppPath(), 'lib', 'mediaLibrary.js');
const { mediaLibrary, downloadToTemp, addMediaToFrontMatter } = require(mediaLibPath);

const addMissingMediaPlugin = {
  clientHookJS: 'client.js',
  priority: 94,
  version: '0.2.0',

  register(AppContext) {
    AppCtx = AppContext;
    AppContext.log('[add-missing-media-plugin] Registered!');
  },

  api: {
    'add-media': async function (_event, data) {
      const { slug, mdFile } = data;
      const { addMissingMediaDialog } = require('./dialogHandler');
      await addMissingMediaDialog(slug, mdFile, AppCtx);
    },

    'add-selected-file': async function (_event, data) {

      const { slug, mdFile, tagType } = data;
      const presDir = path.join(AppCtx.config.presentationsDir, slug);
      const mdPath = path.join(presDir, mdFile);

      if (!fs.existsSync(mdPath)) {
        return { success: false, error: `Markdown file not found: ${mdPath}` };
      }

      // Open file picker in Electron main process
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Media File',
        properties: ['openFile'],
        filters: [
          { name: 'Media Files', extensions: ['jpg','jpeg','png','webp','gif','mp4','webm','mov','mkv'] }
        ]
      });

      if (canceled || !filePaths.length) return { success: false, error: 'No file selected' };

      const src = filePaths[0];
      const dest = path.join(presDir, path.basename(src));

      // Copy file into presentation folder
      fs.copyFileSync(src, dest);

      const encoded = encodeURIComponent(path.basename(dest));
      let tag = '';
      switch (tagType) {
        case 'background':
          tag = `\n---\n\n![background](${encoded})\n`;
          break;
        case 'fit':
          tag = `\n---\n\n![fit](${encoded})\n`;
          break;
        default:
          tag = `\n---\n\n![](${encoded})\n`;
      }

      fs.appendFileSync(mdPath, tag);

      AppCtx.log(`🖼️ Added selected file ${src} to ${slug}/${mdFile}`);
      return { success: true, filename: path.basename(dest) };
    },

    'open-library-dialog': async function (_event, data) {
      const { BrowserWindow } = require('electron');
      const path = require('path');

      const { slug, mdFile, tagType } = data;
      const key = AppCtx.config.key; // ✅ required for correct namespace

      const query = `?key=${encodeURIComponent(key)}&slug=${encodeURIComponent(slug)}&md=${encodeURIComponent(mdFile)}&tag=${encodeURIComponent(tagType)}&nosidebar=1`;
      //const url = `http://${AppCtx.hostURL}:${AppCtx.config.viteServerPort}/media-library.html${query}`;
      const url = `http://${AppCtx.hostURL}:${AppCtx.config.viteServerPort}/plugins_${key}/addmedia/media-picker.html${query}`;

      const win = new BrowserWindow({
        width: 900,
        height: 700,
        parent: AppCtx.win,
        webPreferences: { preload: AppCtx.preload },
      });
      // win.webContents.openDevTools();  // Uncomment for debugging

      win.setMenu(null);
      AppCtx.log(`[addmedia] Opening media library picker: ${url}`);
      win.loadURL(url);
    },

    'insert-selected-media': async function (_event, data) {

      const { slug, mdFile, tagType, item } = data;
      const presDir = path.join(AppCtx.config.presentationsDir, slug);
      const mdPath = path.join(presDir, mdFile);

      if (!fs.existsSync(mdPath)) {
        return { success: false, error: `Markdown file not found: ${mdPath}` };
      }

      try {
        const item = data.item;

        // 3️⃣ Update YAML front matter
        const tag = addMediaToFrontMatter(mdPath, item);

        // 4️⃣ Append Markdown reference (background, fit, or normal)
        const mdRef =
          tagType === 'background'
            ? `\n\n![background](media:${tag})\n\n`
            : tagType === 'backgroundsticky'
            ? `\n\n![background:sticky](media:${tag})\n\n`
            : tagType === 'fit'
            ? `\n\n![fit](media:${tag})\n\n---\n\n`
            : `\n\n![](media:${tag})\n\n---\n\n`;

        fs.appendFileSync(mdPath, mdRef, 'utf8');

        AppCtx.log(`[addmedia] Inserted ${tagType} media ${item.filename} (${item.original_filename}) into ${slug}/${mdFile}`);
        return { success: true, filename: item.filename, tag };
      } catch (err) {
        AppCtx.log(`[addmedia] Failed to insert media: ${err.message}`);
        return { success: false, error: err.message };
      }
    },

    'process-missing-media': async function (_event, data) {
      const fs = require('fs');
      const path = require('path');

      const { slug, mdFile, tagType, sortOrder } = data;
      const presDir = path.join(AppCtx.config.presentationsDir, slug);
      const mdPath = path.join(presDir, mdFile);

      if (!fs.existsSync(mdPath)) {
        return { success: false, error: `Markdown file not found: ${mdFile}` };
      }

      const allFiles = fs.readdirSync(presDir);
      const mediaFiles = allFiles.filter(f =>
        f.match(/\.(jpg|jpeg|png|gif|webp|bmp|webm|mp4)$/i)
      );

      // Read markdown and find already linked files
      const raw = fs.readFileSync(mdPath, 'utf-8');
      const alreadyLinked = new Set(
        [...raw.matchAll(/\]\(([^)]+)\)/g)]
            .map(m => decodeURIComponent(path.basename(m[1])))
            .concat(['thumbnail.jpg']) // ✅ Exclude thumbnail explicitly
      );

      const newMedia = mediaFiles
        .filter(f => !alreadyLinked.has(f))
        .map(f => ({
          filename: f,
          fullpath: path.join(presDir, f),
          mtime: fs.statSync(path.join(presDir, f)).mtimeMs
        }));

      if (sortOrder === 'date') {
        newMedia.sort((a, b) => a.mtime - b.mtime);
      } else {
        newMedia.sort((a, b) => a.filename.localeCompare(b.filename));
      }

      const generateMarkdown = (filename) => {
        const encoded = encodeURIComponent(filename);
        if (tagType === 'background') {
          return `\n\n![background](${encoded})\n\n`;
        } else if (tagType === 'fit') {
          return `\n\n![fit](${encoded})\n\n---\n\n`;
        } else if (tagType === 'fit') {
          return `\n\n![fit](${encoded})\n\n---\n\n`;
        } else {
          return `\n\n![](${encoded})\n\n---\n\n`;
        }
      };

      const newSlides = newMedia.map(m => generateMarkdown(m.filename)).join('\n');
      fs.appendFileSync(mdPath, '\n\n' + newSlides);

      AppCtx.log(`🖼️ Appended ${newMedia.length} media slides to ${slug}/${mdFile}`);
      return { success: true, count: newMedia.length };
    }
  }
};

module.exports = addMissingMediaPlugin;
