const { BrowserWindow, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const HIDDEN_MARKER = 'hidden';

function extractFrontMatter(raw = '') {
  const match = String(raw).match(FRONTMATTER_RE);
  if (!match) {
    return { metadata: {}, body: String(raw), hasFrontMatter: false };
  }
  try {
    return {
      metadata: yaml.load(match[1]) || {},
      body: String(raw).slice(match[0].length),
      hasFrontMatter: true
    };
  } catch {
    return { metadata: {}, body: String(raw).slice(match[0].length), hasFrontMatter: true };
  }
}

function stringifyMarkdown(metadata, body = '') {
  return `---\n${yaml.dump(metadata || {}, { noRefs: true })}---\n${body}`;
}

function getLanguageFromFileName(mdFile) {
  const base = String(mdFile || '').replace(/\.md$/i, '');
  const match = base.match(/_([a-z]{2,8}(?:-[a-z0-9]{2,8})?)$/i);
  return match ? match[1].toLowerCase() : '';
}

function getAlternativesObject(metadata) {
  if (metadata?.alternatives && typeof metadata.alternatives === 'object' && !Array.isArray(metadata.alternatives)) {
    return metadata.alternatives;
  }
  return null;
}

function isHiddenVariant(metadata) {
  const altVal = String(metadata?.alternatives || '').trim().toLowerCase();
  return altVal === HIDDEN_MARKER;
}

function collectVariantState(presDir, currentMdFile) {
  const files = fs.readdirSync(presDir)
    .filter((name) => name.toLowerCase().endsWith('.md') && name !== '__builder_temp.md')
    .sort();
  const infoByFile = new Map();
  for (const file of files) {
    const fullPath = path.join(presDir, file);
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const parsed = extractFrontMatter(raw);
    infoByFile.set(file, parsed);
  }

  let masterFile = currentMdFile;
  const currentInfo = infoByFile.get(currentMdFile) || { metadata: {} };
  const currentAlternatives = getAlternativesObject(currentInfo.metadata);

  if (currentAlternatives) {
    masterFile = currentMdFile;
  } else if (isHiddenVariant(currentInfo.metadata)) {
    for (const [file, info] of infoByFile.entries()) {
      const alternatives = getAlternativesObject(info.metadata);
      if (alternatives && Object.prototype.hasOwnProperty.call(alternatives, currentMdFile)) {
        masterFile = file;
        break;
      }
    }
  }

  const masterInfo = infoByFile.get(masterFile) || { metadata: {} };
  const alternativesObject = getAlternativesObject(masterInfo.metadata) || {};
  const entries = [];
  const seen = new Set();

  const addEntry = (mdFile, language) => {
    if (!mdFile || seen.has(mdFile) || !infoByFile.has(mdFile)) return;
    seen.add(mdFile);
    entries.push({
      mdFile,
      language: String(language || '').trim().toLowerCase() || getLanguageFromFileName(mdFile) || '',
      isCurrent: mdFile === currentMdFile,
      isMaster: mdFile === masterFile,
      hidden: isHiddenVariant(infoByFile.get(mdFile)?.metadata || {})
    });
  };

  addEntry(masterFile, alternativesObject[masterFile]);
  Object.entries(alternativesObject).forEach(([mdFile, language]) => {
    addEntry(mdFile, language);
  });

  return { entries, masterFile };
}

const presentationBuilderWindow = {
  register(ipcMain, AppContext) {
    ipcMain.handle('open-presentation-builder', async (_event, slug, mdFile = 'presentation.md') => {
      if (!slug || !mdFile) {
        throw new Error('Missing slug or mdFile');
      }
      this.open(AppContext, slug, mdFile);
      return { success: true };
    });

    ipcMain.handle('save-presentation-markdown', async (_event, payload) => {
      const { slug, mdFile, content, targetFile } = payload || {};
      if (!slug || !mdFile) {
        throw new Error('Missing slug or mdFile');
      }
      if (typeof content !== 'string') {
        throw new Error('Missing markdown content');
      }

      const safeSlug = path.basename(String(slug));
      const safeMdFile = path.basename(String(mdFile));
      const safeTarget = targetFile ? path.basename(String(targetFile)) : null;
      const fileName = safeTarget || safeMdFile;

      if (!fileName.endsWith('.md')) {
        throw new Error('Target file must be a .md file');
      }

      const presDir = path.join(AppContext.config.presentationsDir, safeSlug);
      if (!fs.existsSync(presDir)) {
        throw new Error(`Presentation folder not found: ${safeSlug}`);
      }

      const fullPath = path.join(presDir, fileName);
      fs.writeFileSync(fullPath, content, 'utf-8');

      return { success: true, fileName };
    });

    ipcMain.handle('cleanup-presentation-temp', async (_event, payload) => {
      const { slug, tempFile } = payload || {};
      if (!slug || !tempFile) {
        throw new Error('Missing slug or tempFile');
      }
      const safeSlug = path.basename(String(slug));
      const safeTemp = path.basename(String(tempFile));
      if (!safeTemp.endsWith('.md')) {
        throw new Error('Temp file must be a .md file');
      }
      const presDir = path.join(AppContext.config.presentationsDir, safeSlug);
      const fullPath = path.join(presDir, safeTemp);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
      return { success: true };
    });

    ipcMain.handle('get-presentation-variants', async (_event, payload) => {
      const { slug, mdFile = 'presentation.md' } = payload || {};
      if (!slug || !mdFile) {
        throw new Error('Missing slug or mdFile');
      }

      const safeSlug = path.basename(String(slug));
      const safeMdFile = path.basename(String(mdFile));
      const presDir = path.join(AppContext.config.presentationsDir, safeSlug);
      if (!fs.existsSync(presDir)) {
        throw new Error(`Presentation folder not found: ${safeSlug}`);
      }

      return collectVariantState(presDir, safeMdFile);
    });

    ipcMain.handle('add-presentation-variant', async (_event, payload) => {
      const { slug, mdFile = 'presentation.md', language } = payload || {};
      if (!slug || !mdFile) {
        throw new Error('Missing slug or mdFile');
      }
      const lang = String(language || '').trim().toLowerCase();
      if (!lang) {
        throw new Error('Language is required.');
      }
      if (!/^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/.test(lang)) {
        throw new Error('Language must be a simple language code (for example: en, es, pt-br).');
      }

      const safeSlug = path.basename(String(slug));
      const safeMdFile = path.basename(String(mdFile));
      const presDir = path.join(AppContext.config.presentationsDir, safeSlug);
      if (!fs.existsSync(presDir)) {
        throw new Error(`Presentation folder not found: ${safeSlug}`);
      }

      const sourcePath = path.join(presDir, safeMdFile);
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Source file not found: ${safeMdFile}`);
      }

      const variantState = collectVariantState(presDir, safeMdFile);
      const masterFile = variantState.masterFile || safeMdFile;
      const masterPath = path.join(presDir, masterFile);
      const masterBase = masterFile.replace(/\.md$/i, '');
      const newMdFile = `${masterBase}_${lang}.md`;
      const targetPath = path.join(presDir, newMdFile);

      if (fs.existsSync(targetPath)) {
        throw new Error(`Variant file already exists: ${newMdFile}`);
      }

      const sourceRaw = fs.readFileSync(sourcePath, 'utf-8');
      const sourceParsed = extractFrontMatter(sourceRaw);
      const newVariantMetadata = {
        ...(sourceParsed.metadata || {}),
        alternatives: HIDDEN_MARKER
      };
      delete newVariantMetadata.variants;
      fs.writeFileSync(targetPath, stringifyMarkdown(newVariantMetadata, sourceParsed.body), 'utf-8');

      const masterRaw = fs.readFileSync(masterPath, 'utf-8');
      const masterParsed = extractFrontMatter(masterRaw);
      const masterAlternatives = { ...(getAlternativesObject(masterParsed.metadata) || {}) };
      masterAlternatives[newMdFile] = lang;
      const updatedMasterMetadata = {
        ...(masterParsed.metadata || {}),
        alternatives: masterAlternatives
      };
      delete updatedMasterMetadata.variants;
      fs.writeFileSync(masterPath, stringifyMarkdown(updatedMasterMetadata, masterParsed.body), 'utf-8');

      return {
        success: true,
        mdFile: newMdFile,
        language: lang,
        masterFile
      };
    });
  },

  open(AppContext, slug, mdFile) {
    const builderWin = new BrowserWindow({
      width: 1800,
      height: 960,
      webPreferences: {
        preload: AppContext.preload,
      },
    });
    builderWin.setMenu(null);
    builderWin.webContents.setWindowOpenHandler(({ url }) => {
      if (url) {
        shell.openExternal(url).catch((err) => {
          AppContext.error('Failed to open external link:', err.message);
        });
      }
      return { action: 'deny' };
    });

    const url = `/admin/builder.html?dir=presentations_${AppContext.config.key}&slug=${slug}&md=${mdFile}`;
    builderWin.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}${url}`);

    let allowClose = false;
    builderWin.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'F12') {
        builderWin.webContents.openDevTools({ mode: 'detach' });
      }
    });

    builderWin.on('close', async (event) => {
      if (allowClose || builderWin.isDestroyed()) return;
      event.preventDefault();

      let isDirty = false;
      try {
        isDirty = await builderWin.webContents.executeJavaScript(
          'window.__builderGetDirty ? window.__builderGetDirty() : false',
          true
        );
      } catch (err) {
        AppContext.error('Failed to query builder dirty state:', err.message);
      }

      if (!isDirty) {
        allowClose = true;
        builderWin.close();
        return;
      }

      const result = await dialog.showMessageBox(builderWin, {
        type: 'warning',
        buttons: ['Cancel', 'Discard Changes'],
        defaultId: 0,
        cancelId: 0,
        message: 'You have unsaved changes. Are you sure you want to close and lose your changes?',
      });

      if (result.response === 1) {
        allowClose = true;
        builderWin.close();
      }
    });
  }
};

module.exports = { presentationBuilderWindow };
