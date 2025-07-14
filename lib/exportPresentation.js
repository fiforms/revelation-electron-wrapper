const { dialog } = require('electron');
const archiver = require('archiver');
const fs = require('fs');

async function exportPresentation(folderPath, slug) {

  if (!fs.existsSync(folderPath)) {
    return { success: false, error: 'Presentation folder not found.' };
  }
    
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Presentation as ZIP',
    defaultPath: `${slug}.zip`,
    filters: [{ name: 'Zip Files', extensions: ['zip'] }]
  });
    
  if (canceled || !filePath) return { success: false, canceled: true };
    
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });
  
    output.on('close', () => resolve({ success: true, filePath }));
    archive.on('error', err => reject({ success: false, error: err.message }));

    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();
  }); 
}

module.exports = { exportPresentation };
