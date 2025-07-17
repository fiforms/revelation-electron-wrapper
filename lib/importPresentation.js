// lib/importPresentation.js
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const { dialog } = require('electron');

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
      const destPath = path.join(AppContext.config.revelationDir,AppContext.config.presentationsDir, slug);

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

module.exports = { importPresentation };

