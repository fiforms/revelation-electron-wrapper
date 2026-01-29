
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
      await addMissingMediaDialog(slug, mdFile, AppCtx, data);
    },

    'add-selected-file': async function (_event, data) {

      const { slug, mdFile, tagType, returnKey } = data;
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
      if (returnKey) {
        AppCtx.log(`🖼️ Selected file ${src} for ${slug}/${mdFile} (builder mode)`);
        return { success: true, filename: path.basename(dest), encoded };
      }
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

    'add-selected-audio': async function (_event, data) {
      const { slug, mdFile } = data;
      const presDir = path.join(AppCtx.config.presentationsDir, slug);
      const mdPath = path.join(presDir, mdFile);

      if (!fs.existsSync(mdPath)) {
        return { success: false, error: `Markdown file not found: ${mdPath}` };
      }

      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Audio File',
        properties: ['openFile'],
        filters: [
          { name: 'Audio Files', extensions: ['mp3', 'ogg', 'webm', 'wav', 'm4a', 'aac', 'opus'] }
        ]
      });

      if (canceled || !filePaths.length) return { success: false, error: 'No file selected' };

      const src = filePaths[0];
      const dest = path.join(presDir, path.basename(src));

      fs.copyFileSync(src, dest);

      const encoded = encodeURIComponent(path.basename(dest));
      AppCtx.log(`🔊 Added selected audio ${src} to ${slug}/${mdFile}`);
      return { success: true, filename: path.basename(dest), encoded };
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

    'open-bulk-image-dialog': async function (_event, data) {
      const { BrowserWindow } = require('electron');
      const { slug, mdFile, returnKey, tagType } = data || {};
      const key = AppCtx.config.key;
      const query = new URLSearchParams({
        slug: slug || '',
        md: mdFile || '',
        nosidebar: '1'
      });
      if (returnKey) query.set('returnKey', returnKey);
      if (tagType) query.set('tagType', tagType);
      const url = `http://${AppCtx.hostURL}:${AppCtx.config.viteServerPort}/plugins_${key}/addmedia/bulk-import.html?${query.toString()}`;

      const win = new BrowserWindow({
        width: 420,
        height: 220,
        parent: AppCtx.win,
        modal: true,
        webPreferences: { preload: AppCtx.preload },
      });
      win.setMenu(null);
      AppCtx.log(`[addmedia] Opening bulk image import: ${url}`);
      win.loadURL(url);
      return { success: true };
    },

    'insert-selected-media': async function (_event, data) {

      const { slug, mdFile, tagType, item, tag } = data;
      const presDir = path.join(AppCtx.config.presentationsDir, slug);
      const mdPath = path.join(presDir, mdFile);

      if (!fs.existsSync(mdPath)) {
        return { success: false, error: `Markdown file not found: ${mdPath}` };
      }

      try {
        // 3️⃣ Update YAML front matter
        const resolvedTag = addMediaToFrontMatter(mdPath, item, tag);

        // 4️⃣ Append Markdown reference (background, fit, or normal)
        const mdRef =
          tagType === 'background'
            ? `\n\n![background](media:${resolvedTag})\n\n`
            : tagType === 'backgroundsticky'
            ? `\n\n![background:sticky](media:${resolvedTag})\n\n`
            : tagType === 'fit'
            ? `\n\n![fit](media:${resolvedTag})\n\n---\n\n`
            : tagType === 'normal'
            ? `\n\n![](media:${resolvedTag})\n\n---\n\n`
            : '';

        fs.appendFileSync(mdPath, mdRef, 'utf8');

        AppCtx.log(`[addmedia] Inserted ${tagType} media ${item.filename} (${item.original_filename}) into ${slug}/${mdFile}`);
        return { success: true, filename: item.filename, tag: resolvedTag };
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
          return `\n\n![background](${encoded})\n\n---\n\n`;
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
    },

    'bulk-add-images': async function (_event, data) {
      const { slug, mdFile, tagType } = data || {};
      if (!slug) return { success: false, error: 'Presentation slug not provided.' };
      const presDir = path.join(AppCtx.config.presentationsDir, slug);
      const mdPath = path.join(presDir, mdFile || 'presentation.md');

      if (!fs.existsSync(mdPath)) {
        return { success: false, error: `Markdown file not found: ${mdPath}` };
      }

      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Images to Import',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Image Files', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }
        ]
      });

      if (canceled || !filePaths.length) {
        return { success: false, canceled: true, error: 'No files selected' };
      }

      const ensureImportFolder = () => {
        let idx = 1;
        while (idx < 1000) {
          const folderName = `image_import_${String(idx).padStart(2, '0')}`;
          const folderPath = path.join(presDir, folderName);
          if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
            return { folderName, folderPath };
          }
          idx += 1;
        }
        throw new Error('Unable to create import folder.');
      };

      const makeUniqueName = (destDir, originalName) => {
        const parsed = path.parse(originalName);
        let candidate = parsed.base;
        let counter = 1;
        while (fs.existsSync(path.join(destDir, candidate))) {
          candidate = `${parsed.name}-${counter}${parsed.ext}`;
          counter += 1;
        }
        return candidate;
      };

      const { folderName, folderPath } = ensureImportFolder();
      const imported = [];

      for (const src of filePaths) {
        const baseName = makeUniqueName(folderPath, path.basename(src));
        const dest = path.join(folderPath, baseName);
        fs.copyFileSync(src, dest);
        const relPath = path.join(folderName, baseName).replace(/\\/g, '/');
        const encoded = encodeURI(relPath);
        imported.push({ filename: baseName, relPath, encoded });
      }

      const markdown = imported
        .map((item) => {
          if (tagType === 'background') {
            return `\n\n![background](${item.encoded})\n\n---\n\n`;
          }
          if (tagType === 'fit') {
            return `\n\n![fit](${item.encoded})\n\n---\n\n`;
          }
          return `\n\n![](${item.encoded})\n\n---\n\n`;
        })
        .join('');

      AppCtx.log(`🖼️ Imported ${imported.length} images into ${slug}/${folderName}`);
      return { success: true, count: imported.length, folder: folderName, markdown };
    }
  }
};

module.exports = addMissingMediaPlugin;
