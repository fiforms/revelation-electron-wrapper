/**
 * presentationBuilderWindow.js -- the slide/markdown Presentation Builder window and its file IPC.
 * Window: 1800x960, preload.js, /admin/builder.html?dir=&slug=&md= (menu removed, custom context menu with spellcheck
 * and slide actions, dirty-check on close, thumbnail regenerated on close when the markdown is newer). Only one builder
 * window exists at a time: open() while one is open just focuses it, even for another presentation.
 * IPC: open-presentation-builder, save-presentation-markdown (stamps front-matter version, writes manifest),
 *   copy-presentation-media, cleanup-presentation-temp, get-presentation-variants, get-presentation-file-context,
 *   add-presentation-variant (creates a _<lang>.md variant and updates `alternatives`).
 * Exports { presentationBuilderWindow } (open, closeForSlug). Required by main.js and, lazily, by openedPresentation.js
 * (openedPresentation is also required from here at load time, so the lazy require avoids a cycle).
 * Writes are refused for the read-only "opened .revel" slug (assertWritableSlug). Markdown paths are validated by
 * normalizeMarkdownRelativePath / resolveMarkdownPathInPresentation.
 * NOTE: the note-separator / semver helpers duplicate createPresentation.js.
 */

const { BrowserWindow, Menu, dialog, shell, app } = require('electron');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { writePresentationManifest } = require('./presentationManifest');
const { exportSlidesAsImages } = require('./exportWindow');
const { buildServerURL } = require('./serverUrl');
const { assertWritableSlug, isOpenSlug } = require('./openedPresentation');

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const HIDDEN_MARKER = 'hidden';
const NOTE_VERSION_BREAKPOINT = [0, 2, 6];
const MARKDOWN_SEGMENT_RE = /^[a-zA-Z0-9_.-]+$/;

function normalizeMarkdownRelativePath(mdFile, { allowTemp = false } = {}) {
  const raw = String(mdFile || '').trim();
  if (!raw) return null;

  const normalized = path.posix.normalize(raw.replace(/\\/g, '/')).replace(/^\.\/+/, '');
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('../') || normalized === '..') {
    return null;
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || !MARKDOWN_SEGMENT_RE.test(segment))) {
    return null;
  }

  const fileName = segments[segments.length - 1] || '';
  if (!fileName.toLowerCase().endsWith('.md')) return null;
  if (!allowTemp && fileName === '__builder_temp.md') return null;

  return segments.join('/');
}

function resolveMarkdownPathInPresentation(presDir, mdFile, options = {}) {
  const relativePath = normalizeMarkdownRelativePath(mdFile, options);
  if (!relativePath) {
    throw new Error(`Invalid markdown file path: ${mdFile}`);
  }
  const fullPath = path.resolve(presDir, relativePath);
  if (!fullPath.startsWith(`${presDir}${path.sep}`)) {
    throw new Error(`Invalid markdown file path: ${mdFile}`);
  }
  return { relativePath, fullPath };
}

function collectMarkdownFilesRecursive(rootDir, { includeTemp = false } = {}) {
  const files = [];
  const walk = (absDir, relDir = '') => {
    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(absDir, entry.name);
      const relPath = relDir ? path.posix.join(relDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(absPath, relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const normalized = normalizeMarkdownRelativePath(relPath, { allowTemp: includeTemp });
      if (!normalized) continue;
      files.push(normalized);
    }
  };
  walk(rootDir);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

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

function deriveThumbnailName(mdFile) {
  const basename = path.basename(mdFile, path.extname(mdFile));
  return `${basename}.thumb.jpg`;
}

function shouldRegenerateThumbnail(presDir, mdFile) {
  const mdPath = path.join(presDir, mdFile);
  const thumbnailName = deriveThumbnailName(mdFile);
  const thumbnailPath = path.join(presDir, thumbnailName);

  if (!fs.existsSync(mdPath)) return false;
  if (!fs.existsSync(thumbnailPath)) return true;

  const mdStats = fs.statSync(mdPath);
  const thumbStats = fs.statSync(thumbnailPath);
  return mdStats.mtime > thumbStats.mtime;
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
  if (metadata?.alternatives && typeof metadata.alternatives === 'object' && !Array.isArray(metadata.alternatives)) {
    const selfMarker = String(metadata.alternatives.self || '').trim().toLowerCase();
    if (selfMarker === HIDDEN_MARKER) return true;
  }
  const altVal = String(metadata?.alternatives || '').trim().toLowerCase();
  return altVal === HIDDEN_MARKER;
}

function collectMarkdownInfo(presDir) {
  const files = collectMarkdownFilesRecursive(presDir);
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
    const derivedThumbnail = deriveThumbnailName(mdFile);
    // Use metadata thumbnail if provided, otherwise use derived name as default
    let thumbnail = String(metadata?.thumbnail || derivedThumbnail).trim();
    if (!thumbnail) {
      thumbnail = derivedThumbnail;
    }
    return {
      mdFile,
      title: String(metadata?.title || mdFile).trim() || mdFile,
      description: String(metadata?.description || '').trim(),
      thumbnail,
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
    // The builder keeps its own undo history; the page decides whether a
    // field uses it or native undo.
    const runHistoryCommand = (action) => {
      builderWin.webContents.executeJavaScript(
        `window.__revelationBuilderHistory ? window.__revelationBuilderHistory.menu(${JSON.stringify(action)}) : document.execCommand(${JSON.stringify(action)})`,
        true
      ).catch(() => {});
    };
    template.push(
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => runHistoryCommand('undo') },
      { label: 'Redo', accelerator: 'CmdOrCtrl+Y', click: () => runHistoryCommand('redo') },
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
  currentWindow: null,

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
      // A file opened from disk is read-only; only the builder's preview temp file may be written.
      const isTempTarget = targetFile
        && path.posix.basename(String(targetFile).replace(/\\/g, '/')) === '__builder_temp.md';
      if (!isTempTarget) assertWritableSlug(safeSlug);
      const presDir = path.join(AppContext.config.presentationsDir, safeSlug);
      if (!fs.existsSync(presDir)) {
        throw new Error(`Presentation folder not found: ${safeSlug}`);
      }
      const { relativePath: safeMdFile } = resolveMarkdownPathInPresentation(presDir, mdFile, { allowTemp: true });
      const fileName = targetFile
        ? resolveMarkdownPathInPresentation(presDir, targetFile, { allowTemp: true }).relativePath
        : safeMdFile;

      const fullPath = path.join(presDir, fileName);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      const stampedContent = stampVersionInMarkdown(content, app.getVersion());
      fs.writeFileSync(fullPath, stampedContent, 'utf-8');

      if (!targetFile) {
        const markdownFiles = collectMarkdownFilesRecursive(presDir);
        await writePresentationManifest(presDir, {
          appVersion: app.getVersion(),
          savedAt: new Date().toISOString(),
          markdownFiles
        });
      }

      return { success: true, fileName };
    });

    // Copies media files referenced by slides pasted from another presentation.
    // Files are paths relative to each presentation folder. Existing identical
    // files are reused; differing files at the same path get a numeric suffix.
    // Returns { results: [{ from, to, status }] } where status is
    // 'copied' | 'exists' | 'missing' | 'error'.
    ipcMain.handle('copy-presentation-media', async (_event, payload) => {
      const { sourceSlug, targetSlug, files } = payload || {};
      if (!sourceSlug || !targetSlug || !Array.isArray(files)) {
        throw new Error('Missing sourceSlug, targetSlug or files');
      }
      const safeSource = path.basename(String(sourceSlug));
      const safeTarget = path.basename(String(targetSlug));
      assertWritableSlug(safeTarget);
      const sourceDir = path.resolve(AppContext.config.presentationsDir, safeSource);
      const targetDir = path.resolve(AppContext.config.presentationsDir, safeTarget);
      const inside = (root, full) => full.startsWith(`${root}${path.sep}`);
      const sameContents = (a, b) => {
        try {
          const sa = fs.statSync(a);
          const sb = fs.statSync(b);
          return sa.size === sb.size && fs.readFileSync(a).equals(fs.readFileSync(b));
        } catch {
          return false;
        }
      };

      const results = [];
      for (const rel of [...new Set(files.map(String))]) {
        const from = rel;
        try {
          const srcFull = path.resolve(sourceDir, rel);
          if (!inside(sourceDir, srcFull) || /\.md$/i.test(rel)) {
            results.push({ from, to: from, status: 'error' });
            continue;
          }
          if (!fs.existsSync(srcFull) || !fs.statSync(srcFull).isFile()) {
            results.push({ from, to: from, status: 'missing' });
            continue;
          }
          const parsed = path.parse(rel);
          let candidate = rel;
          let attempt = 1;
          let status = 'copied';
          for (;;) {
            const destFull = path.resolve(targetDir, candidate);
            if (!inside(targetDir, destFull)) throw new Error('Invalid destination path');
            if (!fs.existsSync(destFull)) {
              fs.mkdirSync(path.dirname(destFull), { recursive: true });
              fs.copyFileSync(srcFull, destFull);
              break;
            }
            if (sameContents(srcFull, destFull)) {
              status = 'exists';
              break;
            }
            attempt += 1;
            candidate = path.posix.join(parsed.dir.split(path.sep).join('/'), `${parsed.name}-${attempt}${parsed.ext}`);
          }
          results.push({ from, to: candidate, status });
        } catch (err) {
          AppContext.error?.(`copy-presentation-media failed for ${rel}: ${err.message}`);
          results.push({ from, to: from, status: 'error' });
        }
      }
      return { results };
    });

    ipcMain.handle('cleanup-presentation-temp', async (_event, payload) => {
      const { slug, tempFile } = payload || {};
      if (!slug || !tempFile) {
        throw new Error('Missing slug or tempFile');
      }
      const safeSlug = path.basename(String(slug));
      const presDir = path.join(AppContext.config.presentationsDir, safeSlug);
      const { fullPath } = resolveMarkdownPathInPresentation(presDir, tempFile, { allowTemp: true });
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
      const presDir = path.join(AppContext.config.presentationsDir, safeSlug);
      if (!fs.existsSync(presDir)) {
        throw new Error(`Presentation folder not found: ${safeSlug}`);
      }
      const { relativePath: safeMdFile } = resolveMarkdownPathInPresentation(presDir, mdFile);

      return collectVariantState(presDir, safeMdFile);
    });

    ipcMain.handle('get-presentation-file-context', async (_event, payload) => {
      const { slug, mdFile = 'presentation.md' } = payload || {};
      if (!slug || !mdFile) {
        throw new Error('Missing slug or mdFile');
      }

      const safeSlug = path.basename(String(slug));
      const presDir = path.join(AppContext.config.presentationsDir, safeSlug);
      if (!fs.existsSync(presDir)) {
        throw new Error(`Presentation folder not found: ${safeSlug}`);
      }
      const { relativePath: safeMdFile } = resolveMarkdownPathInPresentation(presDir, mdFile);

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
      assertWritableSlug(safeSlug);
      const presDir = path.join(AppContext.config.presentationsDir, safeSlug);
      if (!fs.existsSync(presDir)) {
        throw new Error(`Presentation folder not found: ${safeSlug}`);
      }
      const { relativePath: safeMdFile } = resolveMarkdownPathInPresentation(presDir, mdFile);

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
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
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

  // Close the builder if it is editing this slug (used when the opened file is imported/dismissed).
  closeForSlug(slug) {
    if (this.currentWindow && !this.currentWindow.isDestroyed() && this.currentSlug === slug) {
      this.currentWindow.close();
      this.currentWindow = null; // so open() can create a replacement immediately
      return true;
    }
    return false;
  },

  open(AppContext, slug, mdFile) {
    // If a builder window is already open, focus it and return
    if (this.currentWindow && !this.currentWindow.isDestroyed()) {
      this.currentWindow.focus();
      return;
    }

    const safeSlug = path.basename(String(slug || ''));
    const presDir = path.join(AppContext.config.presentationsDir, safeSlug);
    const safeMdFile = normalizeMarkdownRelativePath(mdFile || 'presentation.md') || 'presentation.md';
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
    this.currentWindow = builderWin;
    this.currentSlug = safeSlug;

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
    const baseURL = buildServerURL(AppContext.hostURL, AppContext.config.viteServerPort, AppContext.config.httpsEnabled);
    builderWin.loadURL(`${baseURL}${url}`);

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
      // A presentation opened from a file is read-only and its copy is disposable: never prompt.
      if (isOpenSlug(safeSlug)) {
        allowClose = true;
        return;
      }
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
        if (shouldRegenerateThumbnail(presDir, safeMdFile)) {
          exportSlidesAsImages(AppContext, safeSlug, safeMdFile, 853, 480, 2, true).catch((err) => {
            AppContext.error('Failed to regenerate thumbnail on close:', err.message);
          });
        }
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
        if (shouldRegenerateThumbnail(presDir, safeMdFile)) {
          exportSlidesAsImages(AppContext, safeSlug, safeMdFile, 853, 480, 2, true).catch((err) => {
            AppContext.error('Failed to regenerate thumbnail on close:', err.message);
          });
        }
      }
    });

    builderWin.on('closed', () => {
      if (this.currentWindow === builderWin) {
        this.currentWindow = null;
      }
    });
  }
};

module.exports = { presentationBuilderWindow };
