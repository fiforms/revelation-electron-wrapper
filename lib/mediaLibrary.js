const { BrowserWindow, app } = require('electron');
const { scanAllPresentations } = require('./mediaUsageScanner');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const yaml = require('js-yaml');
const { dialog } = require('electron');

const transcodeQueue = [];
let transcodeActive = false;
let currentTranscode = null;

const mediaLibrary = {
    register(ipcMain, AppContext) {
        AppContext.callbacks['menu:show-add-media-dialog'] = () => this.addMediaDialog(AppContext);

        ipcMain.handle('hash-and-store-media', async (event, filePath, metadata) => {
            try {
              const result = await this.hashAndStore(filePath, metadata, AppContext);
              return result;
            } catch (err) {
              return { success: false, error: err.message };
            }
        });

        ipcMain.handle('get-used-media', async () => {
          const used = await scanAllPresentations(AppContext.config.presentationsDir);
          return Array.from(used);
        });

        ipcMain.handle('delete-media-item', async (_event, filename) => {
          try {
            const mediaDir = path.join(AppContext.config.presentationsDir, '_media');
            const base = path.join(mediaDir, filename);

            const possibleFiles = [
              base,
              base + '.json',
              base + '.thumbnail.jpg'
            ];

            let deleted = 0;
            for (const f of possibleFiles) {
              if (fs.existsSync(f)) {
                fs.unlinkSync(f);
                deleted++;
              }
            }

            AppContext.log(`🗑 Deleted media: ${filename} (${deleted} files removed)`);
            return { success: true };
          } catch (err) {
            AppContext.error('Delete failed:', err);
            return { success: false, error: err.message };
          }
        });

        ipcMain.handle('download-large-variant', async (_event, filename) => {
          try {
            const result = await this.downloadLargeVariant(filename, AppContext);
            return result;
          } catch (err) {
            return { success: false, error: err.message };
          }
        });

        ipcMain.handle('delete-large-variant', async (_event, filename) => {
          try {
            const result = await this.deleteLargeVariant(filename, AppContext);
            return result;
          } catch (err) {
            return { success: false, error: err.message };
          }
        });

        ipcMain.handle('convert-large-variant', async (_event, filename) => {
          try {
            const result = await this.convertLargeVariant(filename, AppContext);
            return result;
          } catch (err) {
            return { success: false, error: err.message };
          }
        });

        app.whenReady().then(() => resumePendingConversions(AppContext));

    },
    addMediaDialog(AppContext) {
        const libDialog = new BrowserWindow({
            width: 600,
            height: 700,
            webPreferences: {
                preload: AppContext.preload,
            },
        });
        //libDialog.webContents.openDevTools()  // Uncomment for debugging
        libDialog.setMenu(null); 
        const url = '/admin/add-media.html';
        libDialog.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}${url}`);
    },
    async hashAndStore(passedFilePath, metadata, AppContext, relatedFile = null) {
        configureFfmpegPath(AppContext);
        let filePathArray = [];
        if(passedFilePath) {
          filePathArray.push(passedFilePath);
        }
        else {
          const { canceled, filePaths } = await dialog.showOpenDialog({
            title: 'Import Presentation ZIP',
            filters: [{ name: 'Media Files', extensions: ['jpg','jpeg','png','gif','mp4','mov','avi', 'webp'] }],
            properties: ['openFile', 'multiSelections']
          });
          if(canceled || !filePaths.length) return;
          filePathArray = [ ...filePaths ];
        }
        const originalTitle = metadata.title || '';
        const stored = [];
        for(const filePath of filePathArray) {
          const hash = await computeFileHash(filePath, 'md5');
          const ext = path.extname(filePath).toLowerCase();
          const mediaDir = path.join(AppContext.config.presentationsDir, '_media');

          let newFilename = `${hash}${ext}`;
          if(relatedFile) {
            const baseHash = path.basename(relatedFile).split('.')[0];
            newFilename = `${baseHash}.highbitrate${ext}`;
          }
          const newPath = path.join(mediaDir, newFilename);
          const metaPath = `${newPath}.json`;
          const thumbPath = `${newPath}.thumbnail.jpg`;

          if(!originalTitle) {
            metadata.title = path.basename(filePath, ext).replace(/[_-]+/g, ' ');
          }
          metadata['filename'] = newFilename;
          metadata['original_filename'] = path.basename(filePath);
          metadata['thumbnail'] = path.basename(thumbPath);
          metadata['mediatype'] = mediaType(newFilename);

          if (!fs.existsSync(mediaDir)) {
              fs.mkdirSync(mediaDir, { recursive: true });
          }

          if (fs.existsSync(newPath)) {
              AppContext.log(`⚠️ File ${newFilename} already exists. Skipping copy.`);
          } else {
              fs.copyFileSync(filePath, newPath);
              AppContext.log(`✅ Copied to ${newFilename}`);
          }

          // If this is a high bitrate variant, look for the standard version’s JSON
          if (relatedFile) {
            const baseFile = path.join(mediaDir, relatedFile);
            const baseMetaPath = `${baseFile}.json`;

            if (fs.existsSync(baseMetaPath)) {
              try {
                const baseMeta = JSON.parse(fs.readFileSync(baseMetaPath, 'utf-8'));
                baseMeta.large_variant = {
                  filename: newFilename,
                  original_filename: metadata.original_filename || path.basename(filePath),
                  url_direct: metadata.url_direct || null
                };
                baseMeta.large_variant_local = true;
                fs.writeFileSync(baseMetaPath, JSON.stringify(baseMeta, null, 2));
                AppContext.log(`🎞 Linked high-bitrate version to ${path.basename(baseFile)}`);
              } catch (err) {
                AppContext.error(`⚠️ Failed to update base metadata for high-bitrate variant: ${err.message}`);
              }
            }
          }
          else {
            await makeThumbnail(newPath,thumbPath);
            AppContext.log(`✅ Thumbnail created: ${thumbPath}`);

            if (fs.existsSync(metaPath)) {
                AppContext.log(`ℹ️ Metadata already exists: ${path.basename(metaPath)}`);
            } else {
                fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
                AppContext.log(`✅ Metadata saved: ${path.basename(metaPath)}`);
            }
          }
          stored.push({
            filename: newFilename,
            original_filename: path.basename(filePath),
            relatedTo: relatedFile || null
          });
        }
        return { success: true, filename: stored[0]?.filename || null, stored };
    },

    async downloadLargeVariant(baseFilename, AppContext) {
      const mediaDir = path.join(AppContext.config.presentationsDir, '_media');
      const basePath = path.join(mediaDir, baseFilename);
      const baseMetaPath = `${basePath}.json`;
      if (!fs.existsSync(baseMetaPath)) {
        throw new Error(`Metadata not found for: ${baseFilename}`);
      }
      const baseMeta = JSON.parse(fs.readFileSync(baseMetaPath, 'utf-8'));
      const variant = baseMeta.large_variant;
      if (!variant || !variant.url_direct) {
        throw new Error('No high-resolution variant URL available.');
      }
      if (variant.filename) {
        const variantPath = path.join(mediaDir, variant.filename);
        if (fs.existsSync(variantPath)) {
          baseMeta.large_variant_local = true;
          fs.writeFileSync(baseMetaPath, JSON.stringify(baseMeta, null, 2));
          return { success: true, already: true, filename: variant.filename };
        }
      }

      const tmpFile = await downloadToTemp(variant.url_direct);
      const result = await this.hashAndStore(
        tmpFile,
        { url_direct: variant.url_direct, original_filename: variant.original_filename || '' },
        AppContext,
        baseFilename
      );
      fs.unlink(tmpFile, err => {
        if (err) AppContext.warn(`⚠️ Failed to delete temp file: ${tmpFile}`);
      });
      if (result?.filename && AppContext.config.autoConvertAv1Media) {
        const ext = path.extname(result.filename).toLowerCase();
        if (ext === '.webm') {
          queueAv1Conversion(baseFilename, result.filename, AppContext);
        }
      }
      return result;
    },

    async deleteLargeVariant(baseFilename, AppContext) {
      const mediaDir = path.join(AppContext.config.presentationsDir, '_media');
      const basePath = path.join(mediaDir, baseFilename);
      const baseMetaPath = `${basePath}.json`;
      if (!fs.existsSync(baseMetaPath)) {
        throw new Error(`Metadata not found for: ${baseFilename}`);
      }
      const baseMeta = JSON.parse(fs.readFileSync(baseMetaPath, 'utf-8'));
      const variant = baseMeta.large_variant;
      if (!variant || !variant.filename) {
        baseMeta.large_variant_local = false;
        baseMeta.large_variant_converting = false;
        fs.writeFileSync(baseMetaPath, JSON.stringify(baseMeta, null, 2));
        return { success: true, removed: false };
      }
      const variantPath = path.join(mediaDir, variant.filename);
      let removed = false;
      if (fs.existsSync(variantPath)) {
        fs.unlinkSync(variantPath);
        removed = true;
      }
      baseMeta.large_variant_local = false;
      baseMeta.large_variant_converting = false;
      fs.writeFileSync(baseMetaPath, JSON.stringify(baseMeta, null, 2));
      return { success: true, removed, filename: variant.filename };
    },

    async convertLargeVariant(baseFilename, AppContext) {
      const mediaDir = path.join(AppContext.config.presentationsDir, '_media');
      const basePath = path.join(mediaDir, baseFilename);
      const baseMetaPath = `${basePath}.json`;
      if (!fs.existsSync(baseMetaPath)) {
        throw new Error(`Metadata not found for: ${baseFilename}`);
      }
      const baseMeta = JSON.parse(fs.readFileSync(baseMetaPath, 'utf-8'));
      const variant = baseMeta.large_variant;
      if (!variant || !variant.filename) {
        throw new Error('No high-resolution variant filename found.');
      }
      const variantExt = path.extname(variant.filename).toLowerCase();
      if (variantExt !== '.webm') {
        return { success: true, skipped: true, reason: 'not-webm' };
      }
      const variantPath = path.join(mediaDir, variant.filename);
      if (!fs.existsSync(variantPath)) {
        throw new Error(`Variant file missing: ${variant.filename}`);
      }
      if (baseMeta.large_variant_converting) {
        if (!isJobQueued(baseFilename, variant.filename)) {
          enqueueAv1Transcode({ baseFilename, variantFilename: variant.filename }, AppContext);
        } else if (!transcodeActive) {
          processTranscodeQueue();
        }
        return { success: true, queued: true };
      }
      queueAv1Conversion(baseFilename, variant.filename, AppContext);
      return { success: true, queued: true };
    },

    isTranscoding() {
      return transcodeActive || !!currentTranscode || transcodeQueue.length > 0;
    },

    stopActiveTranscode() {
      if (currentTranscode) {
        try {
          currentTranscode.kill('SIGKILL');
        } catch {}
        currentTranscode = null;
      }
      transcodeQueue.length = 0;
      transcodeActive = false;
    },
}

function configureFfmpegPath(AppContext) {
  if (AppContext?.config?.ffmpegPath) {
    ffmpeg.setFfmpegPath(AppContext.config.ffmpegPath);
    return;
  }
  const ffmpegPathCandidate = path.join(
    process.resourcesPath,
    'ffmpeg',
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  );
  if (fs.existsSync(ffmpegPathCandidate)) {
    ffmpeg.setFfmpegPath(ffmpegPathCandidate);
  }
}

function enqueueAv1Transcode(job, AppContext) {
  transcodeQueue.push({ ...job, AppContext });
  if (!transcodeActive) {
    processTranscodeQueue();
  }
}

function isJobQueued(baseFilename, variantFilename) {
  return transcodeQueue.some((job) => job.baseFilename === baseFilename && job.variantFilename === variantFilename);
}

async function processTranscodeQueue() {
  if (transcodeActive) return;
  transcodeActive = true;
  while (transcodeQueue.length) {
    const job = transcodeQueue.shift();
    try {
      await transcodeVariantToH264Mp4(job, job.AppContext);
    } catch (err) {
      markConversionState(job.baseFilename, false, job.AppContext);
      job.AppContext?.error?.(`⚠️ AV1 transcode failed for ${job.variantFilename}: ${err.message}`);
    }
  }
  transcodeActive = false;
}

async function transcodeVariantToH264Mp4(job, AppContext) {
  const mediaDir = path.join(AppContext.config.presentationsDir, '_media');
  const inputPath = path.join(mediaDir, job.variantFilename);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Source file missing: ${job.variantFilename}`);
  }

  const baseHash = path.basename(job.baseFilename).split('.')[0];
  const outputFilename = `${baseHash}.highbitrate.h264.mp4`;
  const outputPath = path.join(mediaDir, outputFilename);
  const tempOutputPath = `${outputPath}.tmp.mp4`;

  configureFfmpegPath(AppContext);

  if (fs.existsSync(outputPath)) {
    await finalizeVariantSwap(job, outputFilename, inputPath, AppContext);
    return;
  }
  if (fs.existsSync(tempOutputPath)) {
    try {
      fs.unlinkSync(tempOutputPath);
    } catch (err) {
      AppContext.warn(`⚠️ Failed to remove temp output: ${path.basename(tempOutputPath)}`);
    }
  }

  await new Promise((resolve, reject) => {
    markConversionState(job.baseFilename, true, AppContext);
    currentTranscode = ffmpeg(inputPath)
      .outputOptions([
        '-c:v', 'libx264',
        '-crf', '22',
        '-maxrate', '40M',
        '-bufsize', '80M',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart'
      ])
      .output(tempOutputPath)
      .on('end', () => {
        currentTranscode = null;
        resolve();
      })
      .on('error', (err) => {
        currentTranscode = null;
        reject(err);
      })
      .run();
  });

  fs.renameSync(tempOutputPath, outputPath);
  await finalizeVariantSwap(job, outputFilename, inputPath, AppContext);
}

async function finalizeVariantSwap(job, outputFilename, inputPath, AppContext) {
  const mediaDir = path.join(AppContext.config.presentationsDir, '_media');
  const basePath = path.join(mediaDir, job.baseFilename);
  const baseMetaPath = `${basePath}.json`;
  if (!fs.existsSync(baseMetaPath)) {
    AppContext.warn(`⚠️ Missing metadata for ${job.baseFilename}; cannot finalize transcode.`);
    return;
  }
  const baseMeta = JSON.parse(fs.readFileSync(baseMetaPath, 'utf-8'));
  if (!baseMeta.large_variant) {
    baseMeta.large_variant = {};
  }
  baseMeta.large_variant.filename = outputFilename;
  baseMeta.large_variant_local = true;
  baseMeta.large_variant_converting = false;
  fs.writeFileSync(baseMetaPath, JSON.stringify(baseMeta, null, 2));

  if (fs.existsSync(inputPath) && path.basename(inputPath) !== outputFilename) {
    try {
      fs.unlinkSync(inputPath);
    } catch (err) {
      AppContext.warn(`⚠️ Failed to delete original variant: ${path.basename(inputPath)}`);
    }
  }
  AppContext.log(`🎞 Converted high-bitrate variant to ${outputFilename}`);
}

function queueAv1Conversion(baseFilename, variantFilename, AppContext) {
  markConversionState(baseFilename, true, AppContext);
  enqueueAv1Transcode({ baseFilename, variantFilename }, AppContext);
}

function markConversionState(baseFilename, isConverting, AppContext) {
  const mediaDir = path.join(AppContext.config.presentationsDir, '_media');
  const basePath = path.join(mediaDir, baseFilename);
  const baseMetaPath = `${basePath}.json`;
  if (!fs.existsSync(baseMetaPath)) return;
  try {
    const baseMeta = JSON.parse(fs.readFileSync(baseMetaPath, 'utf-8'));
    baseMeta.large_variant_converting = !!isConverting;
    fs.writeFileSync(baseMetaPath, JSON.stringify(baseMeta, null, 2));
  } catch (err) {
    AppContext.warn(`⚠️ Failed to update conversion state for ${baseFilename}: ${err.message}`);
  }
}

function resumePendingConversions(AppContext) {
  if (!app.isReady()) return;
  const mediaDir = path.join(AppContext.config.presentationsDir, '_media');
  if (!fs.existsSync(mediaDir)) return;
  const files = fs.readdirSync(mediaDir).filter((f) => f.endsWith('.json') && f !== 'index.json');
  const jobs = [];
  for (const file of files) {
    const baseFilename = path.basename(file, '.json');
    const metaPath = path.join(mediaDir, file);
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (!meta?.large_variant_converting) continue;
      const variantFilename = meta.large_variant?.filename;
      if (!variantFilename || !variantFilename.toLowerCase().endsWith('.webm')) {
        markConversionState(baseFilename, false, AppContext);
        continue;
      }
      const baseHash = baseFilename.split('.')[0];
      const outputFilename = `${baseHash}.highbitrate.h264.mp4`;
      const outputPath = path.join(mediaDir, outputFilename);
      const inputPath = path.join(mediaDir, variantFilename);

      if (fs.existsSync(outputPath)) {
        finalizeVariantSwap({ baseFilename, variantFilename }, outputFilename, inputPath, AppContext);
        continue;
      }
      if (fs.existsSync(inputPath)) {
        jobs.push({ baseFilename, variantFilename });
      } else {
        markConversionState(baseFilename, false, AppContext);
      }
    } catch (err) {
      AppContext.warn(`⚠️ Failed to resume conversion for ${file}: ${err.message}`);
    }
  }

  if (!jobs.length) return;

  const buttons = [
    AppContext.translate('Finish Now'),
    AppContext.translate('Cancel')
  ];
  const response = AppContext.win
    ? dialog.showMessageBoxSync(AppContext.win, {
        type: 'warning',
        buttons,
        defaultId: 0,
        cancelId: 1,
        title: AppContext.translate('Conversion in progress'),
        message: AppContext.translate('There is an unfinished conversion task in the queue. Would you like to finish it now?')
      })
    : dialog.showMessageBoxSync({
        type: 'warning',
        buttons,
        defaultId: 0,
        cancelId: 1,
        title: AppContext.translate('Conversion in progress'),
        message: AppContext.translate('There is an unfinished conversion task in the queue. Would you like to finish it now?')
      });

  if (response !== 0) {
    for (const job of jobs) {
      markConversionState(job.baseFilename, false, AppContext);
    }
    return;
  }

  for (const job of jobs) {
    enqueueAv1Transcode(job, AppContext);
  }
}

// Efficiently compute hash without loading full file into memory
async function computeFileHash(filePath, algorithm = 'md5') {
  const hash = crypto.createHash(algorithm);
  const input = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
    input.on('error', reject);
  });
}

function mediaType(media) {
  const ext = path.extname(media).toLowerCase();
  const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
  const isVideo = ['.mp4', '.webm', '.mov', '.mkv'].includes(ext);
  if(isImage) return 'image';
  if(isVideo) return 'video';
  return 'unknown';
}

async function makeThumbnail(media, target) {
  const mType = mediaType(media);

  if (!fs.existsSync(media)) {
    throw new Error(`Source file not found: ${media}`);
  }

  if (mType === 'image') {
    try {
      const sharp = require('sharp');
      return await sharp(media)
        .resize({ width: 512, height: 512, fit: 'inside' })
        .toFile(target);
    } catch (err) {
      console.warn('⚠️ sharp failed, falling back to ffmpeg:', err.message);

      return new Promise((resolve, reject) => {
        ffmpeg(media)
          .outputOptions([
            '-vf', 'scale=w=512:h=512:force_original_aspect_ratio=decrease',
            '-frames:v', '1'
          ])
          .output(target)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
    }
  } else if (mType === 'video') {
    return new Promise((resolve, reject) => {
      ffmpeg(media)
        .screenshots({
          timestamps: ['00:00:01.000'],
          filename: path.basename(target),
          folder: path.dirname(target),
          size: '512x?'
        })
        .on('end', resolve)
        .on('error', reject);
    });
  } else {
    throw new Error(`Unsupported media type for thumbnail: ${media}`);
  }
}

async function downloadToTemp(url) {
  const os = require('os');
  const https = require('https');
  const tmpDir = os.tmpdir();

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
        return;
      }

      let filename;

      if (!filename && res.headers['content-disposition']) {
        const match = res.headers['content-disposition'].match(/filename="?([^"]+)"?/);
        if (match) filename = match[1];
      }

      if (!filename) {
          filename = 'downloaded';
      }

      // Ensure it has a safe name and valid extension
      filename = filename.replace(/[/\\?%*:|"<>]/g, '_'); // sanitize
      if (!path.extname(filename)) filename += '.jpg';

      const tmpPath = path.join(tmpDir, filename);

      const file = fs.createWriteStream(tmpPath);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(tmpPath)));
    }).on('error', reject);
  });
}

function addMediaToFrontMatter(mdPath, meta, tagOverride = null) {
  let content = fs.readFileSync(mdPath, 'utf8');
  let fmStart = content.indexOf('---\n');
  let fmEnd = -1;
  let frontMatter = {};
  let body = content;

  if (fmStart === 0) {
    fmEnd = content.indexOf('\n---', 4);
    if (fmEnd > 0) {
      const yamlText = content.slice(4, fmEnd).trim();
      frontMatter = yaml.load(yamlText) || {};
      body = content.slice(fmEnd + 4).trimStart();
    }
  }

  if (!frontMatter.media) {
    frontMatter.media = {};
  }

  const normalizeTag = (value) => value.toLowerCase();
  const isValidTag = (value) => /^[a-z0-9_]+$/.test(value);

  // 1️⃣ Check if filename already exists
  for (const [tag, entry] of Object.entries(frontMatter.media)) {
    if (entry.filename === meta.filename) {
      return tag; // ✅ Already exists — return the tag
    }
  }

  if (tagOverride) {
    const normalized = normalizeTag(tagOverride);
    if (!isValidTag(normalized)) {
      throw new Error('Tag must contain only lowercase letters, numbers, and underscores.');
    }
    if (frontMatter.media[normalized]) {
      const existing = frontMatter.media[normalized];
      if (existing.filename !== meta.filename) {
        throw new Error(`Tag already exists: ${normalized}`);
      }
      return normalized;
    }
    tagOverride = normalized;
  }

  // 2️⃣ Generate a new unique tag
  const baseTag = (meta.original_filename || 'media')
    .split(/\W+/)[0]
    .slice(0, 7)
    || 'media';

  let tag = tagOverride;
  if (!tag) {
    let digits = (meta.filename.match(/\d/g) || []).slice(0, 4);
    while (digits.length < 4) digits.push(String(Math.floor(Math.random() * 10)));
    let attempt = 0;
    do {
      const suffix = attempt === 0 ? digits.join('') : digits.join('') + String(attempt);
      tag = `${baseTag}${suffix}`.toLowerCase();
      attempt += 1;
    } while (frontMatter.media[tag] && frontMatter.media[tag].filename !== meta.filename);
  }

  // 3️⃣ Add new entry
  const entry = {
    filename: meta.filename || '',
    title: meta.title || '',
    mediatype: meta.mediatype || '',
    description: meta.description || '',
    attribution: meta.attribution || '',
    license: meta.license || '',
    url_origin: meta.url_origin || '',
    url_library: meta.url_library || '',
    url_direct: meta.url_direct || ''
  };
  if (meta.large_variant && meta.large_variant.filename) {
    entry.large_variant = {
      filename: meta.large_variant.filename || '',
      original_filename: meta.large_variant.original_filename || '',
      url_direct: meta.large_variant.url_direct || ''
    };
  }
  frontMatter.media[tag] = entry;

  // 4️⃣ Save updated front matter
  const newYaml = `---\n${yaml.dump(frontMatter)}---\n`;
  fs.writeFileSync(mdPath, newYaml + body, 'utf8');

  return tag;
}

module.exports = { mediaLibrary, downloadToTemp, addMediaToFrontMatter };
