const { BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const exportWindow = {
  register(ipcMain, AppContext) {
    ipcMain.handle('show-export-window', (event, slug, mdFile) => this.open(AppContext, slug, mdFile));
    ipcMain.handle('export-presentation-images', async (_event, slug, mdFile, width, height, delay, thumbnail) => {
      return await exportSlidesAsImages(AppContext, slug, mdFile, width, height, delay, thumbnail);
    });
    ipcMain.handle('export-presentation-pdf-raster', async (_event, slug, mdFile, width, height, delay) => {
      return await exportSlidesAsRasterPDF(AppContext, slug, mdFile, width, height, delay);
    });
  },

  open(AppContext, slug = null, mdFile = null) {
    const exportWin = new BrowserWindow({
      width: 600,
      height: 680,
      webPreferences: { preload: AppContext.preload }
    });
    exportWin.setMenu(null);
    const safeMdFile = String(mdFile || '').trim() || 'presentation.md';
    const query = slug
      ? `?slug=${encodeURIComponent(slug)}&md=${encodeURIComponent(safeMdFile)}`
      : '';
    exportWin.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/admin/export.html${query}`);
  }
};

function normalizeExportDimensions(width, height, delay) {
  const safeWidth = Number.isFinite(Number(width)) && Number(width) > 0 ? Math.floor(Number(width)) : 1920;
  const safeHeight = Number.isFinite(Number(height)) && Number(height) > 0 ? Math.floor(Number(height)) : 1080;
  const safeDelay = Number.isFinite(Number(delay)) && Number(delay) >= 0 ? Number(delay) : 1;
  return { safeWidth, safeHeight, safeDelay };
}

async function captureSlidesToImageFolder(AppContext, slug, mdFile, width, height, delay, exportDir) {
  const { safeWidth, safeHeight, safeDelay } = normalizeExportDimensions(width, height, delay);
  const lang = String(
    AppContext?.config?.preferredPresentationLanguage ||
    AppContext?.config?.language ||
    ''
  ).trim().toLowerCase();
  const params = new URLSearchParams();
  params.set('p', mdFile);
  if (lang) {
    params.set('lang', lang);
  }
  const presURL = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/presentations_${AppContext.config.key}/${slug}/index.html?${params.toString()}`;
  fs.mkdirSync(exportDir, { recursive: true });

  const win = new BrowserWindow({
    show: false,
    width: safeWidth,
    height: safeHeight,
    webPreferences: { offscreen: true },
  });

  const imagePaths = [];
  try {
    await win.loadURL(presURL);

    AppContext.log(`Loaded presentation URL: ${presURL} (${safeWidth}x${safeHeight}) Delay: ${safeDelay}`);

    // Wait for Reveal to initialize fully
    await win.webContents.executeJavaScript(`
      new Promise(resolve => {
        if (window.deck && window.deck.isReady()) resolve();
        else window.addEventListener('ready', () => resolve());
      });
    `);

    AppContext.log('Deck Loaded.');

    // Get number of slides
    const totalSlides = await win.webContents.executeJavaScript('window.deck.getTotalSlides();');
    AppContext.log(`📸 Exporting ${totalSlides} slides as images...`);

    await new Promise((r) => setTimeout(r, 3000)); // wait for transitions

    for (let i = 1; i < 1000; i++) {
      const image = await win.webContents.capturePage();
      const imgPath = path.join(exportDir, `slide-${String(i).padStart(3, '0')}.jpg`);
      fs.writeFileSync(imgPath, image.toJPEG(90));
      imagePaths.push(imgPath);
      AppContext.log(`🖼️ Saved ${imgPath}`);
      if (await win.webContents.executeJavaScript('deck.isLastSlide();')) break;
      await win.webContents.executeJavaScript('deck.next();');
      await new Promise((r) => setTimeout(r, 1000 * safeDelay)); // wait for transitions
    }

    return { success: true, exportDir, imagePaths, width: safeWidth, height: safeHeight };
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

async function exportSlidesAsImages(AppContext, slug, mdFile, width, height, delay, thumbnail) {
  if (thumbnail) {
    const thumbnailDir = path.join(AppContext.config.presentationsDir, slug, '_images_thumbnail');
    try {
      const capture = await captureSlidesToImageFolder(AppContext, slug, mdFile, width, height, delay, thumbnailDir);
      const firstImage = capture?.imagePaths?.[0];
      if (!firstImage) {
        return { success: false, error: 'No slides captured for thumbnail.' };
      }
      const imgPath = path.join(AppContext.config.presentationsDir, slug, 'thumbnail.jpg');
      fs.copyFileSync(firstImage, imgPath);
      return { success: true, filePath: imgPath };
    } finally {
      fs.rmSync(thumbnailDir, { recursive: true, force: true });
    }
  }

  const exportDir = path.join(AppContext.config.presentationsDir, slug, '_images');
  try {
    const capture = await captureSlidesToImageFolder(AppContext, slug, mdFile, width, height, delay, exportDir);
    if (!capture?.imagePaths?.length) {
      return { success: false, error: 'No slides captured for image export.' };
    }

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

    return { success: true, filePath };
  } finally {
    fs.rmSync(exportDir, { recursive: true, force: true });
  }
}

async function exportSlidesAsRasterPDF(AppContext, slug, mdFile, width, height, delay) {
  const exportDir = path.join(AppContext.config.presentationsDir, slug, '_images_pdf');
  try {
    const capture = await captureSlidesToImageFolder(AppContext, slug, mdFile, width, height, delay, exportDir);
    if (!capture?.imagePaths?.length) {
      return { success: false, error: 'No slides captured for PDF export.' };
    }

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export PDF (Raster Mode)',
      defaultPath: `${slug}.pdf`,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    });

    if (canceled || !filePath) return { success: false, canceled: true };

    const pdfData = await renderImageSlidesToPDF(capture.imagePaths, capture.width, capture.height, exportDir);
    fs.writeFileSync(filePath, pdfData);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    fs.rmSync(exportDir, { recursive: true, force: true });
  }
}

async function renderImageSlidesToPDF(imagePaths, width, height, workDir) {
  const safeWidth = Number.isFinite(Number(width)) && Number(width) > 0 ? Number(width) : 1920;
  const safeHeight = Number.isFinite(Number(height)) && Number(height) > 0 ? Number(height) : 1080;
  const htmlSlides = imagePaths.map((imgPath) => {
    const src = path.basename(imgPath);
    return `<section class="page"><img src="${src}" alt=""></section>`;
  }).join('');
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page { size: ${safeWidth}px ${safeHeight}px; margin: 0; }
    html, body { margin: 0; padding: 0; background: #000; }
    .page {
      width: ${safeWidth}px;
      height: ${safeHeight}px;
      margin: 0;
      page-break-after: always;
      break-after: page;
    }
    .page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  </style>
</head>
<body>${htmlSlides}</body>
</html>`;
  const htmlPath = path.join(workDir || path.dirname(imagePaths[0] || '.'), '_raster_pdf_render.html');
  fs.writeFileSync(htmlPath, html, 'utf8');

  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true }
  });
  try {
    await pdfWin.loadFile(htmlPath);
    await pdfWin.webContents.executeJavaScript(`
      Promise.all(Array.from(document.images).map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      }));
    `);
    return await pdfWin.webContents.printToPDF({
      printBackground: true,
      marginsType: 1,
      preferCSSPageSize: true
    });
  } finally {
    if (fs.existsSync(htmlPath)) {
      fs.unlinkSync(htmlPath);
    }
    if (!pdfWin.isDestroyed()) {
      pdfWin.close();
    }
  }
}

module.exports = { exportWindow, exportSlidesAsImages };
