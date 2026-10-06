// Presentation import: from a .revel/.zip file (runZipImport) or from a hosted URL via its
// manifest.json (runUrlImport), plus recovery of media that is missing from the shared
// <presentationsDir>/_media library (importMissingMediaFromYaml).
// IPC channels: open-import-presentation, select-import-presentation-zip,
// import-presentation-zip, import-presentation-url, import-missing-media. Menu callback:
// menu:import-presentation. Also called directly by openedPresentation.js (read-only opens).
// Pipeline (ZIP): validate path -> revelFormat.extractRevelArchive (content rules, SVG sanitizing,
// size limits) -> originMark.propagateOriginMark -> check files against manifest.json (size/sha1)
// -> move _resources/_media into the shared library -> offer to download missing media ->
// delete top-level .html and _resources -> touch .md files so watchers refresh.
// Pipeline (URL): fetch manifest -> stream each listed file to disk (httpUtil: no memory buffering,
// per-file and total size caps, idle timeout) with the same name/signature/SVG rules ->
// originMark.markDownloaded -> record sync peers (presentationSyncPeers). Missing-media downloads
// are vetted with revelFormat.vetFileOnDisk before they enter the shared `_media` library.
// Format and security notes: doc/dev/REVEL_FORMAT.md, doc/dev/REVEL_IMPLEMENTATION.md.
// Security: the media `filename` values read from an imported file's front matter / media
// sidecars (importMediaFromResources, importMissingMediaFromYaml) are untrusted. They must pass
// pathSafety.isSafeMediaFilename (plain basename, not a prohibited type) before being joined onto
// the shared `_media` path; entries that fail are skipped with a warning. Downloaded files are
// written with COPYFILE_EXCL so an existing library file is never overwritten.
const { getActiveFfmpegPath } = require('./ffmpegResolver');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BrowserWindow, dialog, app } = require('electron');
const { downloadToTemp } = require('./mediaLibrary');
const { isSafeMediaFilename, resolveInside, slugify } = require('./pathSafety');
const ffmpeg = require('fluent-ffmpeg');
const { buildServerURL } = require('./serverUrl');
const { upsertSyncPeer } = require('./presentationSyncPeers');
const { OPEN_SLUG, assertWritableSlug } = require('./openedPresentation');
const { propagateOriginMark, markDownloaded } = require('./originMark');
const {
  extractRevelArchive, compareVersions, isProhibitedName, isUnsafeEntryName, hasHiddenSegment, prohibitionReason,
  sanitizeSvg, finalExtension, vetFileOnDisk, MAX_TOTAL_BYTES, MAX_SVG_BYTES
} = require('./revelFormat');
const { downloadToFile, fetchBuffer, DEFAULT_MAX_FILE_BYTES } = require('./httpUtil');
const { parseFrontMatter } = require('./frontMatter');

const importPresentation = {
  register(ipcMain, AppContext) {
    AppContext.callbacks['menu:import-presentation'] = () => this.open(AppContext);

    // IPC Handler to open the Import Presentation window (same as menu action)
    ipcMain.handle('open-import-presentation', () => {
      this.open(AppContext);
    });

    ipcMain.handle('select-import-presentation-zip', async () => {
      try {
        const selection = await selectZipFile();
        if (!selection) {
          return { success: false, canceled: true };
        }
        return {
          success: true,
          zipPath: selection,
          suggestedSlug: suggestZipSlug(selection, AppContext.config.presentationsDir)
        };
      } catch (err) {
        AppContext.error('❌ ZIP selection failed:', err.message);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('import-presentation-zip', async (_event, payload = {}) => {
      try {
        return await this.runZipImport(payload, AppContext);
      } catch (err) {
        AppContext.error('❌ ZIP import failed:', err.message);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('import-presentation-url', async (_event, payload = {}) => {
      try {
        return await this.runUrlImport(payload, AppContext);
      } catch (err) {
        AppContext.error('❌ URL import failed:', err.message);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('import-missing-media', async (_event, slug) => {
      try {
        assertWritableSlug(slug);
        const presPath = resolvePresentationPath(slug, AppContext);
        const result = await importMissingMediaFromYaml(presPath, AppContext);
        return { success: true, ...result };
      } catch (err) {
        AppContext.error('❌ Import missing media failed:', err.message);
        return { success: false, error: err.message };
      }
    });
  },

  open(AppContext) {
    const importWin = new BrowserWindow({
      width: 780,
      height: 760,
      webPreferences: {
        preload: AppContext.preload,
      },
    });

    importWin.setMenu(null);
    const url = buildServerURL(AppContext.hostURL, AppContext.config.viteServerPort, AppContext.config.httpsEnabled);
    importWin.loadURL(`${url}/admin/import-presentation.html`);
  },

  // Extracts a .revel/.zip into the library. Steps and security notes are in
  // doc/dev/REVEL_IMPLEMENTATION.md ("Import and extraction"); also used by openedPresentation.js
  // for read-only opens. The file format is specified in doc/dev/REVEL_FORMAT.md.
  async runZipImport(payload, AppContext) {
    let zipPath = String(payload?.zipPath || '').trim();
    if (!zipPath) {
      const selection = await selectZipFile();
      if (!selection) {
        return { success: false, canceled: true };
      }
      zipPath = selection;
    }

    const validatedZipPath = validateZipPath(zipPath);
    const rawSlug = String(payload?.slug || '').trim();
    // The transient slug for a file opened from the OS is fixed, replaces any previous copy,
    // and is not passed through slugify (which would strip its leading underscore).
    const isOpenedFile = rawSlug === OPEN_SLUG;
    const requestedSlug = isOpenedFile ? OPEN_SLUG : slugify(rawSlug);
    if (rawSlug && !requestedSlug) {
      throw new Error('Destination slug is invalid.');
    }
    if (isOpenedFile) {
      fs.rmSync(path.join(AppContext.config.presentationsDir, OPEN_SLUG), { recursive: true, force: true });
    } else if (requestedSlug === OPEN_SLUG) {
      throw new Error('Destination slug is reserved.');
    }
    const destPath = requestedSlug
      ? resolvePresentationDestPath(AppContext.config.presentationsDir, requestedSlug)
      : uniquePresentationDestPath(
        AppContext.config.presentationsDir,
        slugify(path.basename(validatedZipPath, path.extname(validatedZipPath))) || 'presentation'
      );

    // Extraction enforces the .revel content rules (doc/dev/REVEL_FORMAT.md section 3.1): scripts,
    // executables, archives and hidden paths are skipped, SVG is sanitized, and size limits apply.
    let extraction;
    try {
      extraction = await extractRevelArchive(validatedZipPath, destPath);
    } catch (err) {
      fs.rmSync(destPath, { recursive: true, force: true });
      throw err;
    }
    // Keep the download-origin mark (Mark-of-the-Web / quarantine) of the archive on the documents
    // and other project files taken out of it, as archive tools do. Best effort.
    try {
      const marked = await propagateOriginMark(validatedZipPath, destPath, extraction.names);
      if (marked) AppContext.log(`🏷️ Carried the download-origin mark onto ${marked} extracted file(s)`);
    } catch (err) {
      AppContext.log(`⚠️ Could not carry the download-origin mark: ${err.message}`);
    }
    // Files that were dropped or rewritten no longer match the manifest, so do not validate them.
    const notValidated = new Set([...extraction.skipped.map((s) => s.name), ...extraction.cleaned]);

    let validation = null;
    let newerVersion = null;
    const bundledManifestPath = path.join(destPath, 'manifest.json');
    if (fs.existsSync(bundledManifestPath)) {
      let manifestData = null;
      try {
        manifestData = JSON.parse(fs.readFileSync(bundledManifestPath, 'utf-8'));
      } catch {
        AppContext.log('⚠️ ZIP manifest.json could not be parsed — skipping validation');
      }
      if (manifestData) {
        const fileVersion = String(manifestData.appVersion || '').trim();
        if (fileVersion && compareVersions(fileVersion, app.getVersion()) > 0) {
          newerVersion = { fileVersion, appVersion: app.getVersion() };
          AppContext.log(`⚠️ File was made by a newer version (${fileVersion}); this is ${app.getVersion()}`);
        }
        const { errors, checked } = await validateAgainstManifest(destPath, manifestData, notValidated);
        if (errors.length > 0) {
          const proceed = await showValidationErrorDialog(errors, checked, 'ZIP extraction');
          if (!proceed) {
            fs.rmSync(destPath, { recursive: true, force: true });
            return { success: false, canceled: true, error: 'Import cancelled: validation failed.' };
          }
        }
        validation = { passed: errors.length === 0, checked, errors };
      }
    }

    try {
      await importMediaFromResources(destPath, AppContext);
      await importMissingMediaFromYaml(destPath, AppContext);
    } catch (err) {
      fs.rmSync(destPath, { recursive: true, force: true });
      throw err;
    }

    const files = fs.readdirSync(destPath);
    for (const file of files) {
      const fullPath = path.join(destPath, file);
      if (file.endsWith('.html') && fs.statSync(fullPath).isFile()) {
        fs.unlinkSync(fullPath);
      }
    }

    const resourcesPath = path.join(destPath, '_resources');
    if (fs.existsSync(resourcesPath)) {
      fs.rmSync(resourcesPath, { recursive: true, force: true });
    }

    touchPresentationMarkdownFiles(destPath);

    const slug = path.basename(destPath);
    AppContext.log(`📥 Imported presentation ZIP into ${destPath}`);

    const skippedCount = extraction.skipped.length;
    if (skippedCount) {
      AppContext.log(`⚠️ Skipped ${skippedCount} prohibited entr${skippedCount === 1 ? 'y' : 'ies'}: ${extraction.skipped.map((s) => s.name).join(', ')}`);
    }
    const notes = [];
    if (skippedCount) notes.push(`${skippedCount} prohibited file${skippedCount === 1 ? '' : 's'} skipped`);
    if (newerVersion) notes.push(`made by newer version ${newerVersion.fileVersion}`);

    return {
      success: true,
      slug,
      destPath,
      skipped: extraction.skipped,
      cleaned: extraction.cleaned,
      newerVersion,
      message: `Imported ZIP into ${slug}${notes.length ? ` (${notes.join('; ')})` : ''}`,
      validation
    };
  },

  async runUrlImport(payload, AppContext) {
    const url = String(payload?.url || '').trim();
    if (!url) {
      throw new Error('A presentation URL is required.');
    }

    const parsedInput = parseHttpUrl(url);
    const resolvedRemote = await resolveRemotePresentationSource(parsedInput);
    const baseUrl = resolvedRemote.baseUrl;
    const manifestUrl = resolvedRemote.manifestUrl;
    const manifest = resolvedRemote.manifest;
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('Manifest is empty or invalid JSON.');
    }
    if (!Array.isArray(manifest.files) || !manifest.files.length) {
      throw new Error('Manifest is missing a non-empty files array.');
    }

    const requestedSlug = String(payload?.slug || '').trim();
    const slug = slugify(requestedSlug) || buildDefaultSlugFromUrl(baseUrl);
    if (!slug) {
      throw new Error('Unable to determine a valid destination slug.');
    }

    const presentationsBase = path.resolve(AppContext.config.presentationsDir);
    const destPath = path.resolve(presentationsBase, slug);
    if (!destPath.startsWith(presentationsBase + path.sep)) {
      throw new Error('Invalid destination slug.');
    }
    if (fs.existsSync(destPath)) {
      throw new Error(`Presentation slug already exists: ${slug}`);
    }

    fs.mkdirSync(destPath, { recursive: true });

    let downloaded = 0;
    let totalBytes = 0;
    const validationErrors = [];
    let validationChecked = 0;
    const urlSkipped = [];
    const urlWritten = [];

    try {
      for (const manifestEntry of manifest.files) {
        const relPath = normalizeManifestPath(manifestEntry);
        if (!relPath) continue;

        // Same content rules as a .revel (doc/dev/REVEL_FORMAT.md section 3.1).
        if (isUnsafeEntryName(relPath)) { urlSkipped.push(relPath); continue; }
        if (relPath !== 'manifest.json' && (hasHiddenSegment(relPath) || isProhibitedName(relPath))) {
          if (!hasHiddenSegment(relPath)) urlSkipped.push(relPath);
          continue;
        }

        const sourceUrl = new URL(relPath, baseUrl).toString();
        const targetPath = resolveManifestTarget(destPath, relPath);

        fs.mkdirSync(path.dirname(targetPath), { recursive: true });

        if (relPath === 'manifest.json') {
          fs.writeFileSync(targetPath, await fetchBuffer(sourceUrl));
          downloaded += 1;
          urlWritten.push(relPath);
          continue;
        }

        // Stream to a sibling temp file: media can be several GB, so nothing is held in memory.
        // Size and sha1 are computed on the stream. A file may be at most DEFAULT_MAX_FILE_BYTES, and the
        // whole presentation at most MAX_TOTAL_BYTES (the same total limit a .revel has). An SVG must
        // fit the sanitizer's limit, and one that does not is skipped like any other unsafe file.
        const isSvg = finalExtension(relPath) === '.svg';
        const partPath = `${targetPath}.part-${crypto.randomBytes(6).toString('hex')}`;
        let received;
        try {
          received = await downloadToFile(sourceUrl, partPath, {
            maxBytes: isSvg ? MAX_SVG_BYTES : Math.min(DEFAULT_MAX_FILE_BYTES, MAX_TOTAL_BYTES - totalBytes)
          });
        } catch (err) {
          if (err.code === 'too-large' && isSvg) { urlSkipped.push(relPath); continue; }
          if (err.code === 'too-large') {
            throw new Error(`${relPath} is too large to import (limit ${formatBytes(MAX_TOTAL_BYTES)} for the whole presentation).`);
          }
          throw err;
        }
        totalBytes += received.size;

        // Validate size and sha1 from manifest entry metadata (new-format manifests only)
        if (manifestEntry && typeof manifestEntry === 'object') {
          const { size: expectedSize, sha1: expectedSha1 } = manifestEntry;
          if (expectedSize !== undefined || expectedSha1) {
            validationChecked++;
            if (expectedSize !== undefined && received.size !== expectedSize) {
              validationErrors.push({
                filename: relPath,
                issue: `Size mismatch: expected ${expectedSize} B, got ${received.size} B`
              });
            } else if (expectedSha1 && received.sha1 !== expectedSha1) {
              validationErrors.push({ filename: relPath, issue: 'SHA1 mismatch — file may be corrupted' });
            }
          }
        }

        // Content checks come after validation, which compares the bytes as hosted.
        if (prohibitionReason(relPath, received.head)) {
          fs.rmSync(partPath, { force: true });
          urlSkipped.push(relPath);
          continue;
        }
        if (isSvg) {
          // finalExtension() also catches "a.svg." / "a.svg " (trailing dot or space, which Windows strips).
          const cleaned = sanitizeSvg(fs.readFileSync(partPath));
          fs.rmSync(partPath, { force: true });
          if (!cleaned.ok) { urlSkipped.push(relPath); continue; }
          fs.writeFileSync(targetPath, cleaned.text, 'utf8');
        } else {
          fs.renameSync(partPath, targetPath);
        }
        downloaded += 1;
        urlWritten.push(relPath);
      }
    } catch (err) {
      fs.rmSync(destPath, { recursive: true, force: true });
      throw err;
    }

    if (validationErrors.length > 0) {
      const proceed = await showValidationErrorDialog(validationErrors, validationChecked, 'URL download');
      if (!proceed) {
        fs.rmSync(destPath, { recursive: true, force: true });
        return { success: false, canceled: true, error: 'Import cancelled: validation failed.' };
      }
    }

    const validation = validationChecked > 0
      ? { passed: validationErrors.length === 0, checked: validationChecked, errors: validationErrors }
      : null;

    try {
      await markDownloaded(destPath, urlWritten, parsedInput.toString());
    } catch (err) {
      AppContext.log(`⚠️ Could not mark downloaded files: ${err.message}`);
    }

    if (urlSkipped.length) {
      AppContext.log(`⚠️ Skipped ${urlSkipped.length} prohibited file(s) from URL import: ${urlSkipped.join(', ')}`);
    }

    touchPresentationMarkdownFiles(destPath);
    touchPresentationIndex(AppContext);

    try {
      const now = new Date().toISOString();
      upsertSyncPeer(destPath, {
        kind: 'url',
        sourceUrl: parsedInput.toString(),
        baseUrl: baseUrl.toString(),
        manifestUrl,
        lastAction: 'import',
        lastActionAt: now
      });
      // A presentation hosted by the WordPress plugin can later be published back to the same
      // hosted copy, if this desktop is paired with that site.
      const hosted = detectHostedWordPressSource(manifest, parsedInput);
      if (hosted) {
        upsertSyncPeer(destPath, {
          kind: 'wordpress',
          siteBaseUrl: hosted.siteBaseUrl,
          remoteSlug: hosted.remoteSlug,
          presentationUrl: parsedInput.toString(),
          lastAction: 'import',
          lastActionAt: now,
          ...(hosted.base ? { base: hosted.base } : {})
        });
      }
    } catch (err) {
      AppContext.log(`⚠️ Failed to record sync peer for ${slug}: ${err.message}`);
    }

    AppContext.log(`📥 Imported presentation from URL into ${destPath} (${downloaded} files)`);

    return {
      success: true,
      slug,
      destPath,
      manifestUrl,
      downloaded,
      skipped: urlSkipped,
      message: `Imported ${downloaded} files into ${slug}${urlSkipped.length ? ` (${urlSkipped.length} prohibited file${urlSkipped.length === 1 ? '' : 's'} skipped)` : ''}`,
      validation
    };
  }
};

function resolvePresentationPath(slug, AppContext) {
  if (!slug || typeof slug !== 'string') {
    throw new Error('Missing presentation slug.');
  }
  let presPath;
  try {
    presPath = resolveInside(AppContext.config.presentationsDir, slug);
  } catch {
    throw new Error('Invalid presentation slug.');
  }
  if (!fs.existsSync(presPath)) {
    throw new Error(`Presentation folder not found: ${presPath}`);
  }
  return presPath;
}

function randomFourDigits() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

function buildDefaultSlugFromUrl(baseUrl) {
  const parts = baseUrl.pathname.split('/').filter(Boolean);
  let base = parts.length ? parts[parts.length - 1] : 'presentation';
  base = slugify(base);
  if (!base) base = 'presentation';
  return `${base}-${randomFourDigits()}`;
}

function uniquePresentationDestPath(presentationsDir, baseSlug) {
  const initial = path.join(presentationsDir, baseSlug);
  if (!fs.existsSync(initial)) return initial;

  let candidate = `${initial}_${Date.now()}`;
  while (fs.existsSync(candidate)) {
    candidate = `${candidate}_1`;
  }
  return candidate;
}

function resolvePresentationDestPath(presentationsDir, slug) {
  let candidate;
  try {
    candidate = resolveInside(presentationsDir, slug);
  } catch {
    throw new Error('Invalid destination slug.');
  }
  if (fs.existsSync(candidate)) {
    throw new Error(`Presentation slug already exists: ${slug}`);
  }
  return candidate;
}

function suggestZipSlug(zipPath, presentationsDir) {
  const baseSlug = slugify(path.basename(zipPath, path.extname(zipPath))) || 'presentation';
  const baseDir = path.resolve(presentationsDir);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `${baseSlug}-${randomFourDigits()}`;
    const fullPath = path.resolve(baseDir, candidate);
    if (!fullPath.startsWith(baseDir + path.sep)) continue;
    if (!fs.existsSync(fullPath)) return candidate;
  }

  return `${baseSlug}-${Date.now().toString().slice(-4)}`;
}

function hashFileSha1(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

async function validateAgainstManifest(destPath, manifestData, exclude = new Set()) {
  const errors = [];
  let checked = 0;

  const entries = Array.isArray(manifestData?.files) ? manifestData.files : [];
  for (const entry of entries) {
    const filename = entry?.filename;
    if (!filename || filename === 'manifest.json') continue;
    if (exclude.has(filename)) continue;
    if (entry.size === undefined && !entry.sha1) continue;

    checked++;
    const filePath = path.join(destPath, filename);

    if (!fs.existsSync(filePath)) {
      errors.push({ filename, issue: 'File missing after extraction' });
      continue;
    }

    if (entry.size !== undefined) {
      const actual = fs.statSync(filePath).size;
      if (actual !== entry.size) {
        errors.push({ filename, issue: `Size mismatch: expected ${entry.size} B, got ${actual} B` });
        continue;
      }
    }

    if (entry.sha1) {
      const actual = await hashFileSha1(filePath);
      if (actual !== entry.sha1) {
        errors.push({ filename, issue: 'SHA1 mismatch — file may be corrupted' });
      }
    }
  }

  return { errors, checked };
}

async function showValidationErrorDialog(errors, checked, context) {
  const fileList = errors.map((e) => `  • ${e.filename}: ${e.issue}`).join('\n');
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel Import', 'Import Anyway'],
    defaultId: 0,
    title: 'Validation Failed',
    message: `${errors.length} of ${checked} file(s) failed validation (${context}):`,
    detail: `${fileList}\n\nCancelling is strongly recommended. Only proceed if you understand the risk.`
  });
  return response === 1;
}

function validateZipPath(zipPath) {
  if (!zipPath) {
    throw new Error('ZIP file path is required.');
  }
  const normalized = path.resolve(zipPath);
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
    throw new Error('Selected ZIP file was not found.');
  }
  const ext = path.extname(normalized).toLowerCase();
  if (ext !== '.zip' && ext !== '.revel') {
    throw new Error('Selected file is not a ZIP archive.');
  }
  return normalized;
}

async function selectZipFile() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import Presentation',
    filters: [
      { name: 'REVELation Presentations', extensions: ['revel', 'zip'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
}

function touchPresentationIndex(AppContext) {
  const indexPath = path.join(AppContext.config.presentationsDir, 'index.json');
  if (!fs.existsSync(indexPath)) return;
  const time = new Date();
  fs.utimesSync(indexPath, time, time);
}

function touchPresentationMarkdownFiles(presentationPath) {
  if (!fs.existsSync(presentationPath)) return;
  const mdFiles = fs
    .readdirSync(presentationPath)
    .filter((file) => file.endsWith('.md') && file !== '__builder_temp.md');
  if (!mdFiles.length) return;

  // Bump mtime enough to be reliably observed by file watchers.
  const touchedTime = new Date(Date.now() + 2000);
  for (const mdFile of mdFiles) {
    const mdPath = path.join(presentationPath, mdFile);
    if (!fs.existsSync(mdPath)) continue;
    fs.utimesSync(mdPath, touchedTime, touchedTime);
  }
}

function parseHttpUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL format.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL must start with http:// or https://');
  }

  return parsed;
}

// Recognize a presentation hosted by the REVELation WordPress plugin. Current hosted manifests
// name their site and slug; older ones fall back to the /_revelation/<slug> page URL.
// siteBaseUrl is normalized the same way wordpress_publish stores pairings.
function detectHostedWordPressSource(manifest, parsedInput) {
  let siteUrl = typeof manifest?.siteUrl === 'string' ? manifest.siteUrl : '';
  let remoteSlug = typeof manifest?.remoteSlug === 'string' ? manifest.remoteSlug : '';
  if (!siteUrl || !remoteSlug) {
    const match = parsedInput.pathname.match(/^(.*?)\/_revelation\/([^/]+)(?:\/(?:embed\/?)?)?$/);
    if (!match) return null;
    siteUrl = `${parsedInput.origin}${match[1]}`;
    try {
      remoteSlug = decodeURIComponent(match[2]);
    } catch {
      return null;
    }
  }

  let site;
  try {
    site = new URL(siteUrl);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(site.protocol)) return null;
  site.search = '';
  site.hash = '';
  site.pathname = site.pathname.replace(/\/+$/, '') || '/';
  remoteSlug = remoteSlug.trim();
  if (!/^[a-z0-9_-]+$/i.test(remoteSlug)) return null;

  // Snapshot of what was downloaded, so the first sync back is a real three-way comparison.
  const hashed = (Array.isArray(manifest?.files) ? manifest.files : [])
    .filter((entry) => entry && typeof entry.filename === 'string' && typeof entry.sha1 === 'string' && entry.sha1);
  const base = hashed.length
    ? {
        revision: Math.max(0, Math.floor(Number(manifest.revision) || 0)),
        syncedAt: new Date().toISOString(),
        files: hashed.map((entry) => ({ filename: entry.filename, size: entry.size, sha1: entry.sha1 }))
      }
    : null;

  return {
    siteBaseUrl: site.toString().replace(/\/+$/, ''),
    remoteSlug,
    base
  };
}

function derivePresentationBaseUrl(parsed) {
  const base = new URL(parsed.toString());
  base.search = '';
  base.hash = '';

  if (/\/index\.html?$/i.test(base.pathname)) {
    base.pathname = base.pathname.replace(/\/index\.html?$/i, '/');
  } else if (!base.pathname.endsWith('/')) {
    const idx = base.pathname.lastIndexOf('/');
    base.pathname = idx >= 0 ? `${base.pathname.slice(0, idx + 1)}` : '/';
  }

  return base;
}

async function resolveRemotePresentationSource(parsedInput) {
  const requestedBaseUrl = derivePresentationBaseUrl(parsedInput);
  const requestedManifestUrl = new URL('manifest.json', requestedBaseUrl).toString();

  try {
    return {
      baseUrl: requestedBaseUrl,
      manifestUrl: requestedManifestUrl,
      manifest: await fetchJson(requestedManifestUrl)
    };
  } catch (manifestErr) {
    const pageHtml = await fetchText(requestedBaseUrl.toString());
    const canonicalBaseHref = extractHtmlBaseHref(pageHtml, requestedBaseUrl);
    if (!canonicalBaseHref) {
      throw manifestErr;
    }

    const canonicalBaseUrl = derivePresentationBaseUrl(parseHttpUrl(canonicalBaseHref));
    const canonicalManifestUrl = new URL('manifest.json', canonicalBaseUrl).toString();

    try {
      return {
        baseUrl: canonicalBaseUrl,
        manifestUrl: canonicalManifestUrl,
        manifest: await fetchJson(canonicalManifestUrl)
      };
    } catch (canonicalErr) {
      throw new Error(
        `Failed to load manifest from ${requestedManifestUrl} and fallback ${canonicalManifestUrl}: ${canonicalErr.message}`
      );
    }
  }
}

function extractHtmlBaseHref(html, fallbackUrl) {
  const match = String(html || '').match(/<base\s+[^>]*href=(["'])(.*?)\1/i);
  if (!match || !match[2]) {
    return '';
  }

  try {
    return new URL(match[2], fallbackUrl).toString();
  } catch {
    return '';
  }
}

function normalizeManifestPath(entry) {
  let rawPath = entry;
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    rawPath = entry.filename;
  }

  if (typeof rawPath !== 'string') {
    throw new Error('Manifest files array entries must be string paths or objects with a filename field.');
  }

  let rel = rawPath.trim();
  rel = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!rel || rel.endsWith('/')) return null;
  if (rel.startsWith('/')) {
    throw new Error(`Manifest file path cannot be absolute: ${rawPath}`);
  }

  const segments = rel.split('/');
  if (segments.some((seg) => !seg || seg === '.' || seg === '..')) {
    throw new Error(`Manifest file path is invalid: ${rawPath}`);
  }

  return rel;
}

function resolveManifestTarget(destPath, relPath) {
  try {
    return resolveInside(destPath, relPath);
  } catch {
    throw new Error(`Manifest file path escapes destination folder: ${relPath}`);
  }
}

// Small bodies only (manifest, page HTML): read into memory with httpUtil's buffer cap.
function fetchJson(url) {
  return fetchBuffer(url).then((buffer) => {
    try {
      return JSON.parse(buffer.toString('utf8'));
    } catch {
      throw new Error(`Invalid JSON at ${url}`);
    }
  });
}

function fetchText(url) {
  return fetchBuffer(url).then((buffer) => buffer.toString('utf8'));
}

function formatBytes(bytes) {
  const gib = bytes / (1024 * 1024 * 1024);
  return gib >= 1 ? `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB` : `${Math.round(bytes / (1024 * 1024))} MiB`;
}

async function importMediaFromResources(importedPresFolder, AppContext) {
  const resMediaPath = path.join(importedPresFolder, '_resources', '_media');
  if (!fs.existsSync(resMediaPath)) return;

  const jsonFiles = fs.readdirSync(resMediaPath).filter(f => f.endsWith('.json'));
  if (!jsonFiles.length) return;

  console.log(`📥 Importing ${jsonFiles.length} media assets from ${resMediaPath}`);

  const destMediaPath = path.join(AppContext.config.presentationsDir, '_media');
  fs.mkdirSync(destMediaPath, { recursive: true });

  for (const jsonFile of jsonFiles) {
    const metaPath = path.join(resMediaPath, jsonFile);
    let metadata = {};

    try {
      metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8')) || {};
    } catch (err) {
      console.warn(`⚠️ Could not parse metadata for ${jsonFile}: ${err.message}`);
      continue;
    }

    const filename = metadata.filename;
    if (!filename) {
      console.warn(`⚠️ Skipping ${jsonFile}: missing filename`);
      continue;
    }
    // Untrusted: also covers the variant name, which is copied into the library sidecar below.
    if (!isSafeMediaFilename(filename)
      || (metadata.large_variant?.filename && !isSafeMediaFilename(metadata.large_variant.filename))) {
      console.warn(`⚠️ Skipping ${jsonFile}: unsafe media filename`);
      continue;
    }

    const mediaFile = path.join(resMediaPath, filename);
    const destFile = path.join(destMediaPath, filename);
    const destMeta = path.join(destMediaPath, jsonFile);

    try {
      if (fs.existsSync(mediaFile)) {
        fs.copyFileSync(mediaFile, destFile, fs.constants.COPYFILE_EXCL);
      } else {
        console.warn(`⚠️ Missing media file: ${filename}`);
      }

      fs.copyFileSync(metaPath, destMeta, fs.constants.COPYFILE_EXCL);

      const thumbFile = mediaFile + '.thumbnail.jpg';
      if (fs.existsSync(thumbFile)) {
        fs.copyFileSync(thumbFile, path.join(destMediaPath, path.basename(thumbFile)), fs.constants.COPYFILE_EXCL);
      }

      if (metadata.large_variant?.filename) {
        const largeFile = path.join(resMediaPath, metadata.large_variant.filename);
        if (fs.existsSync(largeFile)) {
          fs.copyFileSync(
            largeFile,
            path.join(destMediaPath, metadata.large_variant.filename),
            fs.constants.COPYFILE_EXCL
          );
        } else {
          console.warn(`⚠️ Large variant missing: ${metadata.large_variant.filename}`);
        }
      }

      console.log(`✅ Imported ${filename}`);
    } catch (err) {
      console.warn(`⚠️ Error importing ${filename}: ${err.message}`);
    }
  }

  console.log('✅ Finished importing media from _resources/_media');
}

async function importMissingMediaFromYaml(importedPresFolder, AppContext) {
  const mdFiles = fs.readdirSync(importedPresFolder).filter(f => f.endsWith('.md'));
  if (!mdFiles.length) {
    return { missingCount: 0, downloadedCount: 0, largeDownloaded: 0, skipped: false };
  }

  const destMediaPath = path.join(AppContext.config.presentationsDir, '_media');
  fs.mkdirSync(destMediaPath, { recursive: true });

  configureFfmpeg(AppContext);

  const missingQueue = new Map();
  const largeVariantQueue = new Map();

  for (const md of mdFiles) {
    const mdPath = path.join(importedPresFolder, md);
    const content = fs.readFileSync(mdPath, 'utf8');
    const parsedFrontMatter = parseFrontMatter(content);
    if (!parsedFrontMatter.hasFrontMatter) continue;
    if (parsedFrontMatter.malformed) {
      console.warn(`⚠️ Could not parse YAML in ${md}: ${parsedFrontMatter.error.message}`);
      continue;
    }
    const frontMatter = parsedFrontMatter.data;

    if (!frontMatter.media || typeof frontMatter.media !== 'object') continue;

    for (const [tag, rawInfo] of Object.entries(frontMatter.media)) {
      if (!rawInfo || typeof rawInfo !== 'object') continue;
      let info = rawInfo;

      const filename = info.filename;
      if (!filename) {
        console.warn(`⚠️ Missing filename for media tag ${tag} in ${md}`);
        continue;
      }
      if (!isSafeMediaFilename(filename)) {
        console.warn(`⚠️ Skipping media tag ${tag} in ${md}: unsafe filename`);
        continue;
      }
      if (info.large_variant?.filename && !isSafeMediaFilename(info.large_variant.filename)) {
        // Drop just the variant, so the unsafe name is neither downloaded nor written to the sidecar.
        console.warn(`⚠️ Ignoring large variant of ${filename} in ${md}: unsafe filename`);
        info = { ...info, large_variant: undefined };
      }

      const destFile = path.join(destMediaPath, filename);
      const url = info.url_direct || info.url_library || info.url_origin;
      if (!fs.existsSync(destFile)) {
        if (!url) {
          console.warn(`⚠️ No download URL for ${filename} (${tag})`);
        } else if (!missingQueue.has(filename)) {
          missingQueue.set(filename, { info, url });
        }
      }

      if (info.large_variant?.filename && info.large_variant?.url_direct) {
        const largeDest = path.join(destMediaPath, info.large_variant.filename);
        if (!fs.existsSync(largeDest) && !largeVariantQueue.has(info.large_variant.filename)) {
          largeVariantQueue.set(info.large_variant.filename, info.large_variant.url_direct);
        }
      }
    }
  }

  if (!missingQueue.size) {
    return { missingCount: 0, downloadedCount: 0, largeDownloaded: 0, skipped: false };
  }

  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Download', 'Cancel'],
    title: 'Download Missing Media?',
    message: `The imported presentation references (${missingQueue.size}) media files that are missing from your library, but may be downloaded.`,
    detail: 'Should I attempt to download these now? Only do this for presentations that you trust. If you are unsure, click cancel and inspect the markdown first, then try importing again.'
  });

  if (response !== 0) {
    console.log('ℹ️ Skipped downloading missing media.');
    return { missingCount: missingQueue.size, downloadedCount: 0, largeDownloaded: 0, skipped: true };
  }

  let downloadedCount = 0;
  for (const [filename, { info, url }] of missingQueue.entries()) {
    const destFile = path.join(destMediaPath, filename);
    const destMeta = `${destFile}.json`;
    const destThumb = `${destFile}.thumbnail.webp`;

    let tmpPath = null;
    try {
      tmpPath = await downloadToTemp(url);
      // Same content rules as a .revel entry: no executable/archive content, SVG sanitized in place.
      const vetted = vetFileOnDisk(tmpPath, filename);
      if (!vetted.ok) {
        console.warn(`⚠️ Not importing ${filename}: ${vetted.reason}`);
        continue;
      }
      fs.copyFileSync(tmpPath, destFile, fs.constants.COPYFILE_EXCL);

      await makeWebpThumbnail(destFile, destThumb, mediaTypeFromFilename(filename));

      const metadata = buildMetadataFromYaml(info, filename, destThumb);
      if (!fs.existsSync(destMeta)) {
        fs.writeFileSync(destMeta, JSON.stringify(metadata, null, 2));
      }

      console.log(`✅ Downloaded and imported missing media: ${filename}`);
      downloadedCount += 1;
    } catch (err) {
      console.warn(`⚠️ Failed downloading ${filename}: ${err.message}`);
    } finally {
      if (tmpPath) fs.rmSync(tmpPath, { force: true });
    }
  }

  let largeDownloaded = 0;
  for (const [largeFilename, url] of largeVariantQueue.entries()) {
    const largeDest = path.join(destMediaPath, largeFilename);
    if (fs.existsSync(largeDest)) continue;
    let tmpLarge = null;
    try {
      tmpLarge = await downloadToTemp(url);
      const vetted = vetFileOnDisk(tmpLarge, largeFilename);
      if (!vetted.ok) {
        console.warn(`⚠️ Not importing large variant ${largeFilename}: ${vetted.reason}`);
        continue;
      }
      fs.copyFileSync(tmpLarge, largeDest, fs.constants.COPYFILE_EXCL);
      console.log(`✅ Downloaded large variant: ${largeFilename}`);
      largeDownloaded += 1;
    } catch (err) {
      console.warn(`⚠️ Failed downloading large variant ${largeFilename}: ${err.message}`);
    } finally {
      if (tmpLarge) fs.rmSync(tmpLarge, { force: true });
    }
  }

  return {
    missingCount: missingQueue.size,
    downloadedCount,
    largeDownloaded,
    skipped: false
  };
}

function buildMetadataFromYaml(info, filename, thumbPath) {
  const metadata = {};
  if (info.title !== undefined) metadata.title = info.title;
  if (info.keywords !== undefined) metadata.keywords = info.keywords;
  if (info.description !== undefined) metadata.description = info.description;
  if (info.attribution !== undefined) metadata.attribution = info.attribution;
  if (info.license !== undefined) metadata.license = info.license;
  if (info.url_origin !== undefined) metadata.url_origin = info.url_origin;
  if (info.url_library !== undefined) metadata.url_library = info.url_library;
  if (info.url_direct !== undefined) metadata.url_direct = info.url_direct;
  metadata.filename = filename;
  metadata.original_filename = info.original_filename || info.title || filename;
  metadata.thumbnail = path.basename(thumbPath);
  metadata.mediatype = info.mediatype || mediaTypeFromFilename(filename);

  if (info.large_variant && typeof info.large_variant === 'object') {
    const largeVariant = {};
    if (info.large_variant.filename) largeVariant.filename = info.large_variant.filename;
    if (info.large_variant.original_filename) {
      largeVariant.original_filename = info.large_variant.original_filename;
    }
    if (info.large_variant.url_direct) largeVariant.url_direct = info.large_variant.url_direct;
    if (Object.keys(largeVariant).length) metadata.large_variant = largeVariant;
  }

  return metadata;
}

// Narrower than mediaLibrary.js mediaType() (no audio, svg or avif).
function mediaTypeFromFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
  const isVideo = ['.mp4', '.webm', '.mov', '.mkv'].includes(ext);
  if (isImage) return 'image';
  if (isVideo) return 'video';
  return 'unknown';
}

function configureFfmpeg(AppContext) {
  const ffmpegPath = getActiveFfmpegPath(AppContext);
  if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
}

// Overlaps mediaLibrary.js makeThumbnail(), but writes `.thumbnail.webp`; the library's own
// thumbnails are `.thumbnail.jpg` (delete-media-item treats .webp as legacy).
async function makeWebpThumbnail(mediaPath, targetPath, mediaType) {
  if (!fs.existsSync(mediaPath)) {
    throw new Error(`Source file not found: ${mediaPath}`);
  }

  return new Promise((resolve, reject) => {
    const command = ffmpeg(mediaPath)
      .outputOptions([
        '-vf', 'scale=w=512:h=512:force_original_aspect_ratio=decrease',
        '-vframes', '1'
      ])
      .output(targetPath)
      .on('end', resolve)
      .on('error', reject);

    if (mediaType === 'video') {
      command.seekInput('00:00:01.000');
    }

    command.run();
  });
}

// The two media helpers are exported for tests/importMedia.test.js only; slugify for openedPresentation.js.
module.exports = { importPresentation, importMediaFromResources, importMissingMediaFromYaml };
