const { BrowserWindow } = require('electron');
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
    async hashAndStore(filePath, metadata, AppContext) {
        if(AppContext.config.ffmpegPath) {
          ffmpeg.setFfmpegPath(AppContext.config.ffmpegPath);
        }

        const hash = await computeFileHash(filePath, 'md5');
        const ext = path.extname(filePath).toLowerCase();
        const mediaDir = path.join(AppContext.config.presentationsDir, '_media');

        const newFilename = `${hash}${ext}`;
        const newPath = path.join(mediaDir, newFilename);
        const metaPath = `${newPath}.json`;
        const thumbPath = `${newPath}.thumbnail.webp`;

        metadata['hashed_filename'] = newFilename;
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

        await makeThumbnail(newPath,thumbPath);
        AppContext.log(`✅ Thumbnail created: ${thumbPath}`);

        if (fs.existsSync(metaPath)) {
            AppContext.log(`ℹ️ Metadata already exists: ${path.basename(metaPath)}`);
        } else {
            fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
            AppContext.log(`✅ Metadata saved: ${path.basename(metaPath)}`);
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
  const mType = mediaType(media)

  if (!fs.existsSync(media)) {
    throw new Error(`Source file not found: ${media}`);
  }

  if (mType === 'image') {
    const sharp = require('sharp');

    return sharp(media)
      .resize({ width: 512, height: 512, fit: 'inside' })
      .toFile(target);
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
      throw new Error(`Unsupported media type.`);
  }

}

module.exports = { mediaLibrary };
