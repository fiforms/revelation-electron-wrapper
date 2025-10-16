const { BrowserWindow } = require('electron');
const { scanAllPresentations } = require('./mediaUsageScanner');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');

const mediaLibrary = {
    register(ipcMain, AppContext) {
        AppContext.callbacks['menu:show-add-media-dialog'] = () => this.addMediaDialog(AppContext);

        ipcMain.handle('hash-and-store-media', async (event, filePath, metadata) => {
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
    async hashAndStore(filePath, metadata, AppContext, relatedFile = null) {
        if(AppContext.config.ffmpegPath) {
          ffmpeg.setFfmpegPath(AppContext.config.ffmpegPath);
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


module.exports = { mediaLibrary };
