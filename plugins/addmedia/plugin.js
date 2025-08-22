
// plugins/addmedia/plugin.js

let AppCtx = null;

const addMissingMediaPlugin = {
  clientHookJS: 'client.js',
  priority: 94,

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
            .concat(['thumbnail.webp']) // ✅ Exclude thumbnail explicitly
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
          return `\n---\n\n![background](${encoded})\n`;
        } else if (tagType === 'fit') {
          return `\n---\n\n![fit](${encoded})\n`;
        } else {
          return `\n---\n\n![](${encoded})\n`;
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
