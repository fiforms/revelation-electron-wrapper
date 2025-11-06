// lib/importPresentation.js
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const { dialog } = require('electron');
const { mediaLibrary } = require('./mediaLibrary'); // adjust path as needed

const importPresentation = {
  register(ipcMain, AppContext) {

    AppContext.callbacks['menu:import-presentation'] = () => {
      console.log('Import Presentation Menu Clicked');
      this.run(AppContext);
    };
  },

  async run(AppContext) {

    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import Presentation ZIP',
      filters: [{ name: 'Zip Files', extensions: ['zip'] }],
      properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) return;

    const zipPath = filePaths[0];

    try {
      const slug = path.basename(zipPath, '.zip');
      const destPath = path.join(AppContext.config.presentationsDir, slug);

      if (fs.existsSync(destPath)) {
        const { response } = await dialog.showMessageBox({
          type: 'question',
          buttons: ['Overwrite', 'Cancel'],
          title: 'Presentation Exists',
          message: `A presentation named "${slug}" already exists. Overwrite?`
        });
        if (response !== 0) return;
        fs.rmSync(destPath, { recursive: true, force: true });
      }

      await fs.promises.mkdir(destPath, { recursive: true });
      await new Promise((resolve, reject) => {
        fs.createReadStream(zipPath)
          .pipe(unzipper.Extract({ path: destPath }))
          .on('close', resolve)
          .on('error', reject);
      });

      await importMediaFromResources(destPath, AppContext);

      // 🧹 Cleanup: remove .html files and _resources
      const files = fs.readdirSync(destPath);
      for (const file of files) {
        const fullPath = path.join(destPath, file);
        if (file.endsWith('.html')) {
          fs.unlinkSync(fullPath);
        }
      }
      const resourcesPath = path.join(destPath, '_resources');
      if (fs.existsSync(resourcesPath)) {
        fs.rmSync(resourcesPath, { recursive: true, force: true });
      }

      AppContext.log(`📥 Imported presentation to ${destPath}`);
      dialog.showMessageBox({ message: `✅ Imported: ${slug} into ${destPath}`, buttons: ['OK'] });

      const indexPath = path.join(AppContext.config.presentationsDir, 'index.json');
      if (fs.existsSync(indexPath)) {
        const time = new Date();
        fs.utimesSync(indexPath, time, time);
      }

    } catch (err) {
      AppContext.error('❌ Import failed:', err.message);
      dialog.showMessageBox({ type: 'error', message: `Import failed:\n${err.message}` });
    }
  }
};

async function importMediaFromResources(importedPresFolder, AppContext) {
  const resMediaPath = path.join(importedPresFolder, '_resources', '_media');
  if (!fs.existsSync(resMediaPath)) return;

  const jsonFiles = fs.readdirSync(resMediaPath).filter(f => f.endsWith('.json'));
  if (!jsonFiles.length) return;

  console.log(`📥 Importing ${jsonFiles.length} media assets from ${resMediaPath}`);

  // Destination: shared media folder (e.g., presentations_<key>/_media)
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

      // Copy JSON metadata
      fs.copyFileSync(metaPath, destMeta, fs.constants.COPYFILE_EXCL);

      // Copy thumbnail if it exists
      const thumbFile = mediaFile + '.thumbnail.jpg';
      if (fs.existsSync(thumbFile)) {
        fs.copyFileSync(thumbFile, path.join(destMediaPath, path.basename(thumbFile)), fs.constants.COPYFILE_EXCL);
      }

      // Handle large variant
      if (metadata.large_variant?.filename) {
        const largeFile = path.join(resMediaPath, metadata.large_variant.filename);
        if (fs.existsSync(largeFile)) {
          fs.copyFileSync(
            largeFile,
            path.join(destMediaPath, metadata.large_variant.filename, fs.constants.COPYFILE_EXCL)
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


module.exports = { importPresentation };

