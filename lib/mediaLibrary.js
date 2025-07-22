const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
        const hash = await computeFileHash(filePath, 'md5');
        const ext = path.extname(filePath).toLowerCase();
        const mediaDir = path.join(AppContext.config.revelationDir, AppContext.config.presentationsDir, '_media');

        const newFilename = `${hash}${ext}`;
        const newPath = path.join(mediaDir, newFilename);
        const metaPath = `${newPath}.json`;

        metadata['hashed_filename'] = newFilename;
        metadata['original_filename'] = path.basename(filePath);

        if (!fs.existsSync(mediaDir)) {
            fs.mkdirSync(mediaDir, { recursive: true });
        }

        if (fs.existsSync(newPath)) {
            console.log(`⚠️ File ${newFilename} already exists. Skipping copy.`);
        } else {
            fs.copyFileSync(filePath, newPath);
            console.log(`✅ Copied to ${newFilename}`);
        }

        if (fs.existsSync(metaPath)) {
            console.log(`ℹ️ Metadata already exists: ${path.basename(metaPath)}`);
        } else {
            fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
            console.log(`✅ Metadata saved: ${path.basename(metaPath)}`);
        }

        return newFilename;
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

module.exports = { mediaLibrary };
