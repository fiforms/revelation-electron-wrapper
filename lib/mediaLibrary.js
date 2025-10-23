const { BrowserWindow } = require('electron');
const { scanAllPresentations } = require('./mediaUsageScanner');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const yaml = require('js-yaml');
const { dialog } = require('electron');

const mediaLibrary = {
    register(ipcMain, AppContext) {
        AppContext.callbacks['menu:show-add-media-dialog'] = () => this.addMediaDialog(AppContext);

        ipcMain.handle('hash-and-store-media', async (event, filePath, metadata) => {
          console.log(filePath);
            try {
              const newFilename = await this.hashAndStore(filePath, metadata, AppContext);
              return { success: true, filename: newFilename };
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
              base + '.thumbnail.webp'
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
        if(AppContext.config.ffmpegPath) {
          ffmpeg.setFfmpegPath(AppContext.config.ffmpegPath);
        }
        else {
          const ffmpegPathCandidate = path.join(
            process.resourcesPath,
            'ffmpeg',
            process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
          );
          if (fs.existsSync(ffmpegPathCandidate)) {
            ffmpeg.setFfmpegPath(ffmpegPathCandidate);
          }
        }
        let filePath = passedFilePath;

        if(filePath === null) {
          const { canceled, filePaths } = await dialog.showOpenDialog({
            title: 'Import Presentation ZIP',
            filters: [{ name: 'Media Files', extensions: ['jpg','jpeg','png','gif','mp4','mov','avi', 'webp'] }],
            properties: ['openFile']
          });
          console.log(filePaths);
          if(canceled || !filePaths.length) return;
          filePath = filePaths[0];
        }

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
        const thumbPath = `${newPath}.thumbnail.webp`;

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
                original_filename: path.basename(filePath),
                url_direct: metadata.url_direct || null
              };
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

        return newFilename;
    },
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

function addMediaToFrontMatter(mdPath, meta) {
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

  // 1️⃣ Check if filename already exists
  for (const [tag, entry] of Object.entries(frontMatter.media)) {
    if (entry.filename === meta.filename) {
      return tag; // ✅ Already exists — return the tag
    }
  }

  // 2️⃣ Generate a new unique tag
  const baseTag = (meta.original_filename || 'media')
    .split(/\W+/)[0]
    .slice(0, 7)
    || 'media';

  const found = (meta.filename.match(/\d/g) || []).slice(0, 4);
  while (found.length < 4) found.push(String(Math.floor(Math.random() * 10)));
  const digits = found.join('');
  const tag = `${baseTag}${digits}`;

  // 3️⃣ Add new entry
  frontMatter.media[tag] = {
    filename: meta.filename || '',
    title: meta.title || '',
    description: meta.description || '',
    copyright: meta.copyright || '',
    url: meta.url || ''
  };

  // 4️⃣ Save updated front matter
  const newYaml = `---\n${yaml.dump(frontMatter)}---\n`;
  fs.writeFileSync(mdPath, newYaml + body, 'utf8');

  return tag;
}

module.exports = { mediaLibrary, downloadToTemp, addMediaToFrontMatter };
