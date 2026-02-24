const { BrowserWindow, Menu, dialog, shell, app } = require('electron');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { writePresentationManifest } = require('./presentationManifest');

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const HIDDEN_MARKER = 'hidden';
const NOTE_VERSION_BREAKPOINT = [0, 2, 6];

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

function stampVersionInMarkdown(content, version) {
  const raw = String(content ?? '');
  const appVersion = String(version || '').trim();
  if (!appVersion) return raw;

  const match = raw.match(FRONTMATTER_RE);
  if (match) {
    let metadata = {};
    try {
      const parsed = yaml.load(match[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = { ...parsed };
      }
    } catch {
      // Keep malformed front matter as-is to avoid destructive rewrites.
      return raw;
    }
    const existingVersion = metadata.version;
    metadata.version = appVersion;
    const body = raw.slice(match[0].length);
    const normalizedBody =
      isLegacyNoteVersion(existingVersion) && isNewNoteVersion(appVersion)
        ? normalizeNoteSeparators(body)
        : body;
    return stringifyMarkdown(metadata, normalizedBody);
  }

  const normalizedBody = isNewNoteVersion(appVersion) ? normalizeNoteSeparators(raw) : raw;
  return stringifyMarkdown({ version: appVersion }, normalizedBody);
}

function getLanguageFromFileName(mdFile) {
  const base = String(mdFile || '').replace(/\.md$/i, '');
  const match = base.match(/_([a-z]{2,8}(?:-[a-z0-9]{2,8})?)$/i);
  return match ? match[1].toLowerCase() : '';
}

function normalizeLanguageCode(code) {
  const lang = String(code || '').trim().toLowerCase();
  if (!lang) return '';
  return /^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/.test(lang) ? lang : '';
}

function readAuthorName(metadata = {}) {
  if (typeof metadata?.author === 'string') return metadata.author;
  if (metadata?.author && typeof metadata.author === 'object') {
    return metadata.author.name || metadata.author.fullname || metadata.author.full || '';
  }
  return '';
}

function resolveSpellcheckerLanguage(session, requestedLanguage) {
  const requested = String(requestedLanguage || '').trim().toLowerCase();
  if (!requested) return '';
  const available = Array.isArray(session?.availableSpellCheckerLanguages)
    ? session.availableSpellCheckerLanguages
    : [];
  if (!available.length) return '';
  const lowerAvailable = available.map((lang) => String(lang || '').toLowerCase());
  const exactIndex = lowerAvailable.findIndex((lang) => lang === requested);
  if (exactIndex >= 0) return available[exactIndex];
  const prefixIndex = lowerAvailable.findIndex((lang) => lang.startsWith(`${requested}-`));
  if (prefixIndex >= 0) return available[prefixIndex];
  return '';
}

function formatAvailableDictionaries(session) {
  const available = Array.isArray(session?.availableSpellCheckerLanguages)
    ? session.availableSpellCheckerLanguages
    : [];
  return available.length ? available.join(', ') : '(none)';
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

function collectMarkdownInfo(presDir) {
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
  return { files, infoByFile };
}

function collectVariantState(presDir, currentMdFile) {
  const { infoByFile } = collectMarkdownInfo(presDir);

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

function buildPresentationFileContext(presDir, currentMdFile) {
  const { files, infoByFile } = collectMarkdownInfo(presDir);
  if (!infoByFile.has(currentMdFile)) {
    throw new Error(`Presentation file not found: ${currentMdFile}`);
  }

  const variantState = collectVariantState(presDir, currentMdFile);
  const languageByMd = new Map();
  const variantMdSet = new Set();
  for (const entry of variantState.entries || []) {
    const mdFile = String(entry?.mdFile || '').trim();
    if (!mdFile) continue;
    variantMdSet.add(mdFile);
    languageByMd.set(mdFile, String(entry?.language || '').trim().toLowerCase());
  }

  const fileEntries = files.map((mdFile) => {
    const metadata = infoByFile.get(mdFile)?.metadata || {};
    return {
      mdFile,
      title: String(metadata?.title || mdFile).trim() || mdFile,
      description: String(metadata?.description || '').trim(),
      thumbnail: String(metadata?.thumbnail || 'thumbnail.jpg').trim() || 'thumbnail.jpg',
      author: String(readAuthorName(metadata) || '').trim(),
      language: languageByMd.get(mdFile) || getLanguageFromFileName(mdFile) || '',
      hidden: isHiddenVariant(metadata),
      inLanguageVariants: variantMdSet.has(mdFile),
      isMaster: mdFile === variantState.masterFile,
      isCurrent: mdFile === currentMdFile
    };
  });

  const selectedFile = fileEntries.find((entry) => entry.mdFile === currentMdFile) || fileEntries[0] || null;
  const languageVariants = fileEntries.filter((entry) => entry.inLanguageVariants);
  const additionalPresentations = fileEntries.filter((entry) => !entry.inLanguageVariants);

  return {
    selectedMdFile: selectedFile?.mdFile || currentMdFile,
    masterFile: variantState.masterFile,
    entries: variantState.entries,
    selected: selectedFile,
    languageVariants,
    additionalPresentations,
    files: fileEntries
  };
}

function getNonMasterVariantLanguage(presDir, mdFile) {
  const languageFromFile = getLanguageFromFileName(mdFile);
  if (!languageFromFile) return '';
  try {
    const variantState = collectVariantState(presDir, mdFile);
    if (variantState?.masterFile === mdFile) return '';
    return languageFromFile;
  } catch {
    return '';
  }
}

async function buildBuilderContextMenu(builderWin, params) {
  const template = [];
  let suggestions = Array.isArray(params?.dictionarySuggestions)
    ? params.dictionarySuggestions
    : [];
  const misspelledWord = String(params?.misspelledWord || '').trim();
  const hasMisspelling = !!misspelledWord;

  if (hasMisspelling && !suggestions.length) {
    try {
      const jsonWord = JSON.stringify(misspelledWord);
      const fallbackSuggestions = await builderWin.webContents.executeJavaScript(
        `window.electronAPI?.getWordSuggestions ? window.electronAPI.getWordSuggestions(${jsonWord}) : []`,
        true
      );
      if (Array.isArray(fallbackSuggestions)) {
        suggestions = fallbackSuggestions;
      }
    } catch {
      // Ignore fallback errors and show menu without suggestions.
    }
  }

  if (hasMisspelling && suggestions.length) {
    suggestions.slice(0, 8).forEach((suggestion) => {
      template.push({
        label: suggestion,
        click: () => builderWin.webContents.replaceMisspelling(suggestion)
      });
    });
    template.push({ type: 'separator' });
  }

  if (hasMisspelling) {
    template.push({
      label: `Add "${misspelledWord}" to Dictionary`,
      click: () => builderWin.webContents.session.addWordToSpellCheckerDictionary(misspelledWord)
    });
    template.push({ type: 'separator' });
  }

  let slideContext = null;
  try {
    const pointX = Number(params?.x);
    const pointY = Number(params?.y);
    if (Number.isFinite(pointX) && Number.isFinite(pointY)) {
      slideContext = await builderWin.webContents.executeJavaScript(
        `(() => {
          const el = document.elementFromPoint(${pointX}, ${pointY});
          const title = el?.closest?.('.slide-title');
          if (!title) return null;
          const item = title.closest('.slide-item');
          if (!item) return null;
          const items = Array.from(document.querySelectorAll('#slide-list .slide-item'));
          const vIndex = items.indexOf(item);
          return vIndex >= 0 ? { vIndex } : null;
        })()`,
        true
      );
    }
  } catch {
    slideContext = null;
  }

  if (slideContext && Number.isInteger(slideContext.vIndex) && slideContext.vIndex >= 0) {
    const runSlideAction = (action) => {
      const payload = JSON.stringify({ action, vIndex: slideContext.vIndex });
      builderWin.webContents.executeJavaScript(
        `window.__builderHandleSlideContextAction ? window.__builderHandleSlideContextAction(${payload}) : false`,
        true
      ).catch(() => {});
    };

    template.push(
      { label: 'Insert Slide', click: () => runSlideAction('insert') },
      { label: 'Duplicate Slide', click: () => runSlideAction('duplicate') },
      { label: 'Delete Slide', click: () => runSlideAction('delete') }
    );
    return Menu.buildFromTemplate(template);
  }

  if (params?.isEditable) {
    template.push(
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    );
  } else {
    template.push({ role: 'copy' });
  }

  return Menu.buildFromTemplate(template);
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
      const stampedContent = stampVersionInMarkdown(content, app.getVersion());
      fs.writeFileSync(fullPath, stampedContent, 'utf-8');

      if (!safeTarget) {
        const markdownFiles = fs.readdirSync(presDir)
          .filter((name) => name.endsWith('.md'))
          .sort();
        writePresentationManifest(presDir, {
          appVersion: app.getVersion(),
          savedAt: new Date().toISOString(),
          markdownFiles
        });
      }

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

    ipcMain.handle('get-presentation-file-context', async (_event, payload) => {
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

      return buildPresentationFileContext(presDir, safeMdFile);
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
      if (!masterAlternatives[masterFile]) {
        const masterLanguage =
          getLanguageFromFileName(masterFile) ||
          normalizeLanguageCode(AppContext.config?.language) ||
          'en';
        masterAlternatives[masterFile] = masterLanguage;
      }
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
    const safeSlug = path.basename(String(slug || ''));
    const safeMdFile = path.basename(String(mdFile || 'presentation.md'));
    const presDir = path.join(AppContext.config.presentationsDir, safeSlug);
    const variantLanguage = getNonMasterVariantLanguage(presDir, safeMdFile);

    const builderWin = new BrowserWindow({
      width: 1800,
      height: 960,
      webPreferences: {
        preload: AppContext.preload,
        spellcheck: false
      },
    });
    builderWin.setMenu(null);

    let activeSpellLanguage = '';
    try {
      const session = builderWin.webContents.session;
      const defaultLanguage = String(AppContext.config?.language || '').trim().toLowerCase();
      const resolvedDefault = defaultLanguage
        ? resolveSpellcheckerLanguage(session, defaultLanguage)
        : '';

      if (variantLanguage) {
        const resolvedVariant = resolveSpellcheckerLanguage(session, variantLanguage);
        if (resolvedVariant) {
          AppContext.log(
            `[builder spellcheck] Requested language "${variantLanguage}" is available as "${resolvedVariant}".`
          );
          activeSpellLanguage = resolvedVariant;
        } else {
          AppContext.log(
            `[builder spellcheck] Requested language "${variantLanguage}" is not available. Available dictionaries: ${formatAvailableDictionaries(session)}`
          );
          if (resolvedDefault) {
            AppContext.log(
              `[builder spellcheck] Falling back to default language "${defaultLanguage}" as "${resolvedDefault}".`
            );
            activeSpellLanguage = resolvedDefault;
          }
        }
      } else if (resolvedDefault) {
        AppContext.log(
          `[builder spellcheck] Master/default variant: using default language "${defaultLanguage}" as "${resolvedDefault}".`
        );
        activeSpellLanguage = resolvedDefault;
      } else if (defaultLanguage) {
        AppContext.log(
          `[builder spellcheck] Master/default variant: default language "${defaultLanguage}" is not available. Available dictionaries: ${formatAvailableDictionaries(session)}`
        );
      }

      if (activeSpellLanguage) {
        session.setSpellCheckerLanguages([activeSpellLanguage]);
      }
    } catch (err) {
      AppContext.error('Failed to configure builder spellchecker language:', err.message);
    }

    builderWin.webContents.setWindowOpenHandler(({ url }) => {
      if (url) {
        shell.openExternal(url).catch((err) => {
          AppContext.error('Failed to open external link:', err.message);
        });
      }
      return { action: 'deny' };
    });
    builderWin.webContents.on('context-menu', (_event, params) => {
      Promise.resolve(buildBuilderContextMenu(builderWin, params)).then((menu) => {
        menu.popup({ window: builderWin });
      });
    });

    const query = new URLSearchParams({
      dir: `presentations_${AppContext.config.key}`,
      slug: safeSlug,
      md: safeMdFile
    });
    if (activeSpellLanguage) {
      query.set('spellLang', activeSpellLanguage);
    }
    const url = `/admin/builder.html?${query.toString()}`;
    builderWin.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}${url}`);

    let allowClose = false;
    /*
    builderWin.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'F12') {
        builderWin.webContents.openDevTools({ mode: 'detach' });
      }
    });
    */

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
