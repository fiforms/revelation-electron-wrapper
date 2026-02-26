
// plugins/addmedia/plugin.js

const { dialog, app } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const xml2js = require('xml2js');
let AppCtx = null;
const mediaLibPath = path.join(app.getAppPath(), 'lib', 'mediaLibrary.js');
const { mediaLibrary, downloadToTemp, addMediaToFrontMatter } = require(mediaLibPath);

const pptxParser = new xml2js.Parser({
  explicitArray: false,
  ignoreAttrs: false
});

const runExec = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => {
    if (err) {
      const message = (stderr || err.message || '').trim();
      const wrapped = new Error(message || 'Command failed');
      wrapped.code = err.code;
      return reject(wrapped);
    }
    resolve(stdout || '');
  });
});

const parsePdfPageSize = (infoText) => {
  const match = infoText.match(/Page\s+\d+\s+size:\s*([\d.]+)\s*x\s*([\d.]+)\s*(pts|pt|in|mm)/i)
    || infoText.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)\s*(pts|pt|in|mm)/i);
  if (!match) return null;
  const rawWidth = Number(match[1]);
  const rawHeight = Number(match[2]);
  const unit = (match[3] || '').toLowerCase();
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) {
    return null;
  }
  let widthPts = rawWidth;
  let heightPts = rawHeight;
  if (unit === 'in') {
    widthPts = rawWidth * 72;
    heightPts = rawHeight * 72;
  } else if (unit === 'mm') {
    widthPts = (rawWidth / 25.4) * 72;
    heightPts = (rawHeight / 25.4) * 72;
  }
  return { widthPts, heightPts };
};

const collectAText = (node, out = []) => {
  if (node == null) return out;
  if (typeof node === 'string' || typeof node === 'number') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectAText(item, out);
    return out;
  }
  if (typeof node !== 'object') return out;

  for (const [key, value] of Object.entries(node)) {
    if (key === 'a:t') {
      if (Array.isArray(value)) {
        for (const item of value) out.push(String(item));
      } else {
        out.push(String(value));
      }
    } else {
      collectAText(value, out);
    }
  }
  return out;
};

const collectNotesWithParagraphs = (obj) => {
  const lines = [];

  const walk = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== 'object') return;

    for (const [key, value] of Object.entries(node)) {
      if (key === 'a:p') {
        const ps = Array.isArray(value) ? value : [value];
        for (const p of ps) {
          const runs = collectAText(p, []);
          const line = runs.join('').replace(/\s+/g, ' ').trim();
          if (line) lines.push(line);
        }
      } else {
        walk(value);
      }
    }
  };

  walk(obj);

  if (lines.length === 0) {
    const flat = collectAText(obj, []).join(' ').replace(/\s+/g, ' ').trim();
    if (flat) lines.push(flat);
  }

  return lines.join('\n\n');
};

const findNotesTarget = (relsObj) => {
  const rels = relsObj?.Relationships?.Relationship;
  if (!rels) return null;
  const list = Array.isArray(rels) ? rels : [rels];
  const notesRel = list.find((rel) => rel?.$?.Type === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide');
  return notesRel?.$?.Target ?? null;
};

const normalizeTargetPath = (target) => {
  if (!target) return null;
  const cleaned = target.replace(/^..\//, 'ppt/');
  return cleaned.startsWith('ppt/') ? cleaned : `ppt/${cleaned}`;
};

const readZipText = async (zip, entryPath) => {
  const entry = zip.files.find((file) => file.path === entryPath);
  if (!entry) return null;
  const buffer = await entry.buffer();
  return buffer.toString('utf8');
};

const extractPptxNotes = async (pptxPath) => {
  const zip = await unzipper.Open.file(pptxPath);
  const slideEntries = zip.files
    .filter((file) => /^ppt\/slides\/slide\d+\.xml$/.test(file.path))
    .sort((a, b) => {
      const na = Number(a.path.match(/slide(\d+)\.xml$/)?.[1] || 0);
      const nb = Number(b.path.match(/slide(\d+)\.xml$/)?.[1] || 0);
      return na - nb;
    });

  const notesBySlide = [];

  for (const slide of slideEntries) {
    const slideNum = Number(slide.path.match(/slide(\d+)\.xml$/)?.[1] || 0);
    if (!slideNum) continue;
    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
    const relsXml = await readZipText(zip, relsPath);
    if (!relsXml) {
      notesBySlide[slideNum] = '';
      continue;
    }

    const relsObj = await pptxParser.parseStringPromise(relsXml);
    const target = findNotesTarget(relsObj);
    if (!target) {
      notesBySlide[slideNum] = '';
      continue;
    }

    const notesZipPath = normalizeTargetPath(target);
    const notesXml = await readZipText(zip, notesZipPath);
    if (!notesXml) {
      notesBySlide[slideNum] = '';
      continue;
    }

    const notesObj = await pptxParser.parseStringPromise(notesXml);
    notesBySlide[slideNum] = collectNotesWithParagraphs(notesObj).trim();
  }

  return notesBySlide;
};

const getPdfPageSize = async (cfg, pdfPath) => {
  const info = await runExec(cfg.pdfinfoPath, ['-f', '1', '-l', '1', pdfPath]);
  console.log('[addmedia] pdfinfo output:', info);
  const parsed = parsePdfPageSize(info);
  if (!parsed) {
    throw new Error('Unable to read PDF page size.');
  }
  return parsed;
};

const addMissingMediaPlugin = {
  clientHookJS: 'client.js',
  priority: 94,
  version: '0.2.7',
  configTemplate: [
    { name: 'pdftoppmPath', type: 'string', description: 'Path to pdftoppm binary', default: '' },
    { name: 'pdfinfoPath', type: 'string', description: 'Path to pdfinfo binary', default: '' }
  ],

  register(AppContext) {
    AppCtx = AppContext;
    AppContext.log('[add-missing-media-plugin] Registered!');
  },

  getCfg() {
    const cfg = AppCtx.plugins['addmedia']?.config || {};
    if (!cfg.pdftoppmPath) cfg.pdftoppmPath = 'pdftoppm';
    if (!cfg.pdfinfoPath) cfg.pdfinfoPath = 'pdfinfo';
    return cfg;
  },

  api: {
    addmedia: async function (_event, data) {
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
        case 'backgroundnoloop':
          tag = `\n---\n\n![background:noloop](${encoded})\n`;
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
        height: 350,
        parent: AppCtx.win,
        modal: true,
        webPreferences: { preload: AppCtx.preload },
      });
      win.setMenu(null);
      AppCtx.log(`[addmedia] Opening bulk image import: ${url}`);
      win.loadURL(url);
      return { success: true };
    },

    'open-bulk-pdf-dialog': async function (_event, data) {
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
      const url = `http://${AppCtx.hostURL}:${AppCtx.config.viteServerPort}/plugins_${key}/addmedia/bulk-pdf.html?${query.toString()}`;

      const win = new BrowserWindow({
        width: 480,
        height: 560,
        parent: AppCtx.win,
        modal: true,
        webPreferences: { preload: AppCtx.preload },
      });
      win.setMenu(null);
      AppCtx.log(`[addmedia] Opening bulk PDF import: ${url}`);
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
            : tagType === 'backgroundnoloop'
            ? `\n\n![background:noloop](media:${resolvedTag})\n\n`
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
        } else if (tagType === 'backgroundnoloop') {
          return `\n\n![background:noloop](${encoded})\n\n---\n\n`;
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
          if (tagType === 'backgroundnoloop') {
            return `\n\n![background:noloop](${item.encoded})\n\n---\n\n`;
          }
          if (tagType === 'fit') {
            return `\n\n![fit](${item.encoded})\n\n---\n\n`;
          }
          return `\n\n![](${item.encoded})\n\n---\n\n`;
        })
        .join('');

      AppCtx.log(`🖼️ Imported ${imported.length} images into ${slug}/${folderName}`);
      return { success: true, count: imported.length, folder: folderName, markdown };
    },

    'bulk-pdf-select': async function (_event, data) {
      const { slug, mdFile } = data || {};
      if (!slug) return { success: false, error: 'Presentation slug not provided.' };
      const presDir = path.join(AppCtx.config.presentationsDir, slug);
      const mdPath = path.join(presDir, mdFile || 'presentation.md');

      if (!fs.existsSync(mdPath)) {
        return { success: false, error: `Markdown file not found: ${mdPath}` };
      }

      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select PDF to Import',
        properties: ['openFile'],
        filters: [
          { name: 'PDF Files', extensions: ['pdf'] }
        ]
      });

      if (canceled || !filePaths.length) {
        return { success: false, canceled: true, error: 'No file selected' };
      }

      const cfg = addMissingMediaPlugin.getCfg();
      const pdfPath = filePaths[0];

      try {
        const pageSize = await getPdfPageSize(cfg, pdfPath);
        return {
          success: true,
          pdfPath,
          filename: path.basename(pdfPath),
          page: pageSize
        };
      } catch (err) {
        if (err.code === 'ENOENT') {
          return { success: false, missingPoppler: true, error: 'Poppler (pdfinfo) was not found.' };
        }
        return { success: false, error: `pdfinfo failed: ${err.message}` };
      }
    },

    'bulk-pptx-select': async function (_event, data) {
      const { slug, mdFile } = data || {};
      if (!slug) return { success: false, error: 'Presentation slug not provided.' };
      const presDir = path.join(AppCtx.config.presentationsDir, slug);
      const mdPath = path.join(presDir, mdFile || 'presentation.md');

      if (!fs.existsSync(mdPath)) {
        return { success: false, error: `Markdown file not found: ${mdPath}` };
      }

      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select PPTX for Speaker Notes (Optional)',
        properties: ['openFile'],
        filters: [
          { name: 'PowerPoint Files', extensions: ['pptx'] }
        ]
      });

      if (canceled || !filePaths.length) {
        return { success: false, canceled: true, error: 'No file selected' };
      }

      const pptxPath = filePaths[0];
      return { success: true, pptxPath, filename: path.basename(pptxPath) };
    },

    'bulk-import-pdf': async function (_event, data) {
      const { slug, mdFile, tagType, preset, pdfPath: providedPdfPath, dpi: providedDpi, pptxPath } = data || {};
      if (!slug) return { success: false, error: 'Presentation slug not provided.' };
      const presDir = path.join(AppCtx.config.presentationsDir, slug);
      const mdPath = path.join(presDir, mdFile || 'presentation.md');

      if (!fs.existsSync(mdPath)) {
        return { success: false, error: `Markdown file not found: ${mdPath}` };
      }

      const cfg = addMissingMediaPlugin.getCfg();
      let pdfPath = providedPdfPath;

      if (!pdfPath) {
        const { canceled, filePaths } = await dialog.showOpenDialog({
          title: 'Select PDF to Import',
          properties: ['openFile'],
          filters: [
            { name: 'PDF Files', extensions: ['pdf'] }
          ]
        });

        if (canceled || !filePaths.length) {
          return { success: false, canceled: true, error: 'No file selected' };
        }

        pdfPath = filePaths[0];
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

      try {
        await runExec(cfg.pdftoppmPath, ['-v']);
      } catch (err) {
        if (err.code === 'ENOENT') {
          return { success: false, missingPoppler: true, error: 'Poppler (pdftoppm) was not found.' };
        }
        return { success: false, error: `pdftoppm failed: ${err.message}` };
      }

      let pageSize = null;
      try {
        pageSize = await getPdfPageSize(cfg, pdfPath);
      } catch (err) {
        if (err.code === 'ENOENT') {
          if (!Number.isFinite(Number(providedDpi))) {
            return { success: false, missingPoppler: true, error: 'Poppler (pdfinfo) was not found.' };
          }
          AppCtx.log('[addmedia] pdfinfo not found. Proceeding without page size info.');
        } else if (!Number.isFinite(Number(providedDpi))) {
          return { success: false, error: `pdfinfo failed: ${err.message}` };
        } else {
          AppCtx.log(`[addmedia] pdfinfo failed: ${err.message}`);
        }
      }

      let dpi = Number(providedDpi);
      let widthPx = null;
      let heightPx = null;

      if (!Number.isFinite(dpi) || dpi <= 0) {
        if (!pageSize) {
          return { success: false, error: 'PDF page size unavailable for DPI calculation.' };
        }
        const normalizedPreset = (preset || '').toLowerCase();
        const base = normalizedPreset === '4k'
          ? { width: 3840, height: 2160 }
          : { width: 1920, height: 1080 };
        const widthIn = pageSize.widthPts / 72;
        const heightIn = pageSize.heightPts / 72;
        if (pageSize.heightPts > pageSize.widthPts) {
          dpi = base.height / heightIn;
        } else {
          dpi = base.width / widthIn;
        }
      }

      if (!Number.isFinite(dpi) || dpi <= 0) {
        return { success: false, error: 'Invalid DPI provided.' };
      }

      if (pageSize && Number.isFinite(dpi)) {
        widthPx = Math.round(dpi * (pageSize.widthPts / 72));
        heightPx = Math.round(dpi * (pageSize.heightPts / 72));
      }
      const { folderName, folderPath } = ensureImportFolder();
      const outputPrefix = path.join(folderPath, 'page');

      try {
        await runExec(cfg.pdftoppmPath, [
          '-jpeg',
          '-r', String(dpi),
          pdfPath,
          outputPrefix
        ]);
      } catch (err) {
        if (err.code === 'ENOENT') {
          return { success: false, missingPoppler: true, error: 'Poppler (pdftoppm) was not found.' };
        }
        return { success: false, error: `pdftoppm failed: ${err.message}` };
      }

      const generated = fs.readdirSync(folderPath)
        .filter((name) => name.toLowerCase().endsWith('.jpg'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (!generated.length) {
        return { success: false, error: 'No pages were generated.' };
      }

      let notesBySlide = null;
      if (pptxPath) {
        if (!fs.existsSync(pptxPath)) {
          return { success: false, error: `PPTX file not found: ${pptxPath}` };
        }
        try {
          notesBySlide = await extractPptxNotes(pptxPath);
        } catch (err) {
          return { success: false, error: `PPTX notes failed: ${err.message}` };
        }
      }

      const markdown = generated
        .map((filename, index) => {
          const relPath = path.join(folderName, filename).replace(/\\/g, '/');
          const encoded = encodeURI(relPath);
          if (!notesBySlide) {
            return `\n\n![fit](${encoded})\n\n---\n\n`;
          }
          const notesText = (notesBySlide[index + 1] || '').trim();
          if (!notesText) {
            return `\n\n![fit](${encoded})\n\n---\n\n`;
          }
          return `\n\n![fit](${encoded})\n\nNote:\n\n${notesText}\n\n---\n\n`;
        })
        .join('');

      AppCtx.log(`📄 Imported ${generated.length} PDF pages into ${slug}/${folderName} at ${widthPx || '?'}x${heightPx || '?'}`);
      return { success: true, count: generated.length, folder: folderName, width: widthPx, height: heightPx, markdown };
    }
  }
};

module.exports = addMissingMediaPlugin;
