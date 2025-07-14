// lib/importPresentation.js
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const { dialog } = require('electron');

async function importPresentation(presentationsDir, log, error) {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import Presentation ZIP',
    filters: [{ name: 'Zip Files', extensions: ['zip'] }],
    properties: ['openFile']
  });

  if (canceled || filePaths.length === 0) return;

  const zipPath = filePaths[0];

  try {
    const slug = path.basename(zipPath, '.zip');
    const destPath = path.join(presentationsDir, slug);

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

    log(`📥 Imported presentation to ${destPath}`);
    dialog.showMessageBox({ message: `✅ Imported: ${slug}`, buttons: ['OK'] });

    const indexPath = path.join(presentationsDir, 'index.json');
    if (fs.existsSync(indexPath)) {
      const time = new Date();
      fs.utimesSync(indexPath, time, time);
    }

  } catch (err) {
    error('❌ Import failed:', err.message);
    dialog.showMessageBox({ type: 'error', message: `Import failed:\n${err.message}` });
  }
}

module.exports = { importPresentation };

