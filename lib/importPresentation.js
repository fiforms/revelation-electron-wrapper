const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const unzipper = require('unzipper');
const { BrowserWindow, dialog } = require('electron');
const { downloadToTemp } = require('./mediaLibrary');
const yaml = require('js-yaml');
const ffmpeg = require('fluent-ffmpeg');

const importPresentation = {
  register(ipcMain, AppContext) {
    AppContext.callbacks['menu:import-presentation'] = () => this.open(AppContext);

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
      width: 760,
      height: 640,
      webPreferences: {
        preload: AppContext.preload,
      },
    });

    importWin.setMenu(null);
    importWin.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/admin/import-presentation.html`);
  },

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
    const requestedSlug = slugify(rawSlug);
    if (rawSlug && !requestedSlug) {
      throw new Error('Destination slug is invalid.');
    }
    const destPath = requestedSlug
      ? resolvePresentationDestPath(AppContext.config.presentationsDir, requestedSlug)
      : uniquePresentationDestPath(
        AppContext.config.presentationsDir,
        slugify(path.basename(validatedZipPath, '.zip')) || 'presentation'
      );

    await fs.promises.mkdir(destPath, { recursive: true });
    await new Promise((resolve, reject) => {
      fs.createReadStream(validatedZipPath)
        .pipe(unzipper.Extract({ path: destPath }))
        .on('close', resolve)
        .on('error', reject);
    });

    await importMediaFromResources(destPath, AppContext);
    await importMissingMediaFromYaml(destPath, AppContext);

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

    return {
      success: true,
      slug,
      destPath,
      message: `Imported ZIP into ${slug}`
    };
  },

  async runUrlImport(payload, AppContext) {
    const url = String(payload?.url || '').trim();
    if (!url) {
      throw new Error('A presentation URL is required.');
    }

    const parsedInput = parseHttpUrl(url);
    const baseUrl = derivePresentationBaseUrl(parsedInput);
    const manifestUrl = new URL('manifest.json', baseUrl).toString();

    const manifest = await fetchJson(manifestUrl);
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
    try {
      for (const manifestEntry of manifest.files) {
        const relPath = normalizeManifestPath(manifestEntry);
        if (!relPath) continue;

        const sourceUrl = new URL(relPath, baseUrl).toString();
        const targetPath = resolveManifestTarget(destPath, relPath);

        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        const data = await fetchBinary(sourceUrl);
        fs.writeFileSync(targetPath, data);
        downloaded += 1;
      }
    } catch (err) {
      fs.rmSync(destPath, { recursive: true, force: true });
      throw err;
    }

    touchPresentationMarkdownFiles(destPath);
    touchPresentationIndex(AppContext);

    AppContext.log(`📥 Imported presentation from URL into ${destPath} (${downloaded} files)`);

    return {
      success: true,
      slug,
      destPath,
      manifestUrl,
      downloaded,
      message: `Imported ${downloaded} files into ${slug}`
    };
  }
};

function resolvePresentationPath(slug, AppContext) {
  if (!slug || typeof slug !== 'string') {
    throw new Error('Missing presentation slug.');
  }
  const base = path.resolve(AppContext.config.presentationsDir);
  const presPath = path.resolve(base, slug);
  if (!presPath.startsWith(base + path.sep)) {
    throw new Error('Invalid presentation slug.');
  }
  if (!fs.existsSync(presPath)) {
    throw new Error(`Presentation folder not found: ${presPath}`);
  }
  return presPath;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  const base = path.resolve(presentationsDir);
  const candidate = path.resolve(base, slug);
  if (!candidate.startsWith(base + path.sep)) {
    throw new Error('Invalid destination slug.');
  }
  if (fs.existsSync(candidate)) {
    throw new Error(`Presentation slug already exists: ${slug}`);
  }
  return candidate;
}

function suggestZipSlug(zipPath, presentationsDir) {
  const baseSlug = slugify(path.basename(zipPath, '.zip')) || 'presentation';
  const baseDir = path.resolve(presentationsDir);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `${baseSlug}-${randomFourDigits()}`;
    const fullPath = path.resolve(baseDir, candidate);
    if (!fullPath.startsWith(baseDir + path.sep)) continue;
    if (!fs.existsSync(fullPath)) return candidate;
  }

  return `${baseSlug}-${Date.now().toString().slice(-4)}`;
}

function validateZipPath(zipPath) {
  if (!zipPath) {
    throw new Error('ZIP file path is required.');
  }
  const normalized = path.resolve(zipPath);
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
    throw new Error('Selected ZIP file was not found.');
  }
  if (path.extname(normalized).toLowerCase() !== '.zip') {
    throw new Error('Selected file is not a ZIP archive.');
  }
  return normalized;
}

async function selectZipFile() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import Presentation ZIP',
    filters: [{ name: 'Zip Files', extensions: ['zip'] }],
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

function normalizeManifestPath(entry) {
  if (typeof entry !== 'string') {
    throw new Error('Manifest files array must contain only string paths.');
  }

  let rel = entry.trim();
  rel = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!rel || rel.endsWith('/')) return null;
  if (rel.startsWith('/')) {
    throw new Error(`Manifest file path cannot be absolute: ${entry}`);
  }

  const segments = rel.split('/');
  if (segments.some((seg) => !seg || seg === '.' || seg === '..')) {
    throw new Error(`Manifest file path is invalid: ${entry}`);
  }

  return rel;
}

function resolveManifestTarget(destPath, relPath) {
  const safeTarget = path.resolve(destPath, relPath);
  if (!safeTarget.startsWith(destPath + path.sep)) {
    throw new Error(`Manifest file path escapes destination folder: ${relPath}`);
  }
  return safeTarget;
}

function fetchJson(url) {
  return fetchBinary(url).then((buffer) => {
    try {
      return JSON.parse(buffer.toString('utf8'));
    } catch {
      throw new Error(`Invalid JSON at ${url}`);
    }
  });
}

function fetchBinary(url, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error(`Too many redirects while downloading ${url}`));
  }

  const parsed = parseHttpUrl(url);
  const client = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.get(parsed, (res) => {
      const status = res.statusCode || 0;

      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, parsed).toString();
        res.resume();
        fetchBinary(redirectUrl, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status} while downloading ${url}`));
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error(`Timeout while downloading ${url}`));
    });
  });
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
    const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) continue;

    let frontMatter = {};
    try {
      frontMatter = yaml.load(match[1]) || {};
    } catch (err) {
      console.warn(`⚠️ Could not parse YAML in ${md}: ${err.message}`);
      continue;
    }

    if (!frontMatter.media || typeof frontMatter.media !== 'object') continue;

    for (const [tag, info] of Object.entries(frontMatter.media)) {
      if (!info || typeof info !== 'object') continue;

      const filename = info.filename;
      if (!filename) {
        console.warn(`⚠️ Missing filename for media tag ${tag} in ${md}`);
        continue;
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

    try {
      const tmpPath = await downloadToTemp(url);
      fs.copyFileSync(tmpPath, destFile);
      fs.unlinkSync(tmpPath);

      await makeWebpThumbnail(destFile, destThumb, mediaTypeFromFilename(filename));

      const metadata = buildMetadataFromYaml(info, filename, destThumb);
      if (!fs.existsSync(destMeta)) {
        fs.writeFileSync(destMeta, JSON.stringify(metadata, null, 2));
      }

      console.log(`✅ Downloaded and imported missing media: ${filename}`);
      downloadedCount += 1;
    } catch (err) {
      console.warn(`⚠️ Failed downloading ${filename}: ${err.message}`);
    }
  }

  let largeDownloaded = 0;
  for (const [largeFilename, url] of largeVariantQueue.entries()) {
    const largeDest = path.join(destMediaPath, largeFilename);
    if (fs.existsSync(largeDest)) continue;
    try {
      const tmpLarge = await downloadToTemp(url);
      fs.copyFileSync(tmpLarge, largeDest);
      fs.unlinkSync(tmpLarge);
      console.log(`✅ Downloaded large variant: ${largeFilename}`);
      largeDownloaded += 1;
    } catch (err) {
      console.warn(`⚠️ Failed downloading large variant ${largeFilename}: ${err.message}`);
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

function mediaTypeFromFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
  const isVideo = ['.mp4', '.webm', '.mov', '.mkv'].includes(ext);
  if (isImage) return 'image';
  if (isVideo) return 'video';
  return 'unknown';
}

function configureFfmpeg(AppContext) {
  if (AppContext.config.ffmpegPath) {
    ffmpeg.setFfmpegPath(AppContext.config.ffmpegPath);
  } else {
    const ffmpegPathCandidate = path.join(
      process.resourcesPath,
      'ffmpeg',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    );
    if (fs.existsSync(ffmpegPathCandidate)) {
      ffmpeg.setFfmpegPath(ffmpegPathCandidate);
    }
  }
}

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

module.exports = { importPresentation };
