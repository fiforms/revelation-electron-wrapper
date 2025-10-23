const { BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const exportWindow = {
  register(ipcMain, AppContext) {
    ipcMain.handle('show-export-window', (event, slug, mdFile) => this.open(AppContext, slug, mdFile));
    ipcMain.handle('export-presentation-images', async (_event, slug, mdFile, width, height, delay, thumbnail) => {
      return await exportSlidesAsImages(AppContext, slug, mdFile, width, height, delay, thumbnail);
    });
  },

  open(AppContext, slug = null, mdFile = null) {
    const exportWin = new BrowserWindow({
      width: 600,
      height: 600,
      webPreferences: { preload: AppContext.preload }
    });
    exportWin.setMenu(null);
    const query = slug ? `?slug=${slug}&md=${mdFile}` : '';
    exportWin.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/admin/export.html${query}`);
  }
};

async function exportSlidesAsImages(AppContext, slug, mdFile, width, height, delay, thumbnail) {
  const presURL = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/presentations_${AppContext.config.key}/${slug}/index.html?p=${mdFile}`;
  const exportDir = path.join(AppContext.config.presentationsDir, slug, '_images');

  if(!thumbnail) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const win = new BrowserWindow({
    show: false,
    width,
    height,
    webPreferences: { offscreen: true },
  });

  await win.loadURL(presURL);

  AppContext.log(`Loaded presentation URL: ${presURL} (${width}x${height}) Delay: ${delay}`);

  // Wait for Reveal to initialize fully
  await win.webContents.executeJavaScript(`
    new Promise(resolve => {
      if (window.deck && window.deck.isReady()) resolve();
      else window.addEventListener('ready', () => resolve());
    });
  `);

  AppContext.log(`Deck Loaded.`);

  // Get number of slides 
  const totalSlides = await win.webContents.executeJavaScript(`window.deck.getTotalSlides();`);

  AppContext.log(`📸 Exporting ${totalSlides} slides as images...`);

  await new Promise(r => setTimeout(r, 2000)); // wait for transitions

  if(thumbnail) {
    // Export only the first slide as a thumbnail
    const image = await win.webContents.capturePage();
    const imgPath = path.join(AppContext.config.presentationsDir, slug, 'thumbnail.webp');
    fs.writeFileSync(imgPath, image.toWebP({ quality: 90 }));
    win.destroy();
    return { success: true, filePath: imgPath };
  }

  for (let i = 1; i < 1000; i++) {
    const image = await win.webContents.capturePage();
    const imgPath = path.join(exportDir, `slide-${String(i).padStart(3, '0')}.jpg`);
    fs.writeFileSync(imgPath, image.toJPEG(90));
    AppContext.log(`🖼️ Saved ${imgPath}`);
    if(await win.webContents.executeJavaScript(`deck.isLastSlide();`)) break;
    await win.webContents.executeJavaScript(`deck.next();`);
    await new Promise(r => setTimeout(r, 1000 * delay)); // wait for transitions
  }

  win.destroy();

  const { filePath } = await dialog.showSaveDialog({
    title: 'Export Slides as ZIP',
    defaultPath: `${slug}-images.zip`,
    filters: [{ name: 'Zip Files', extensions: ['zip'] }],
  });

  if (!filePath) return { success: true, canceled: true };

  const archiver = require('archiver');
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(exportDir, false);
    archive.finalize();
  });

  fs.rmSync(exportDir, { recursive: true, force: true });

  return { success: true, filePath };
}

module.exports = { exportWindow, exportSlidesAsImages };
