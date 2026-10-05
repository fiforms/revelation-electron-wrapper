const { BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildServerURL } = require('./serverUrl');

function deriveThumbnailName(mdFile) {
  const basename = path.basename(mdFile, path.extname(mdFile));
  return `${basename}.thumb.jpg`;
}

// Sends capture/build progress back to the window that started the export.
function progressSender(event) {
  const sender = event?.sender;
  return (progress) => {
    if (sender && !sender.isDestroyed()) sender.send('export-progress', progress);
  };
}

const exportWindow = {
  register(ipcMain, AppContext) {
    ipcMain.handle('show-export-window', (event, slug, mdFile) => this.open(AppContext, slug, mdFile));
    ipcMain.handle('export-presentation-images', async (event, slug, mdFile, width, height, delay, thumbnail) => {
      return await exportSlidesAsImages(AppContext, slug, mdFile, width, height, delay, thumbnail, progressSender(event));
    });
    ipcMain.handle('export-presentation-pdf-raster', async (event, slug, mdFile, width, height, delay) => {
      return await exportSlidesAsRasterPDF(AppContext, slug, mdFile, width, height, delay, progressSender(event));
    });
    ipcMain.handle('export-presentation-pptx', async (event, slug, mdFile, width, height, delay, options) => {
      const parent = BrowserWindow.fromWebContents(event.sender);
      return await exportSlidesAsPptx(AppContext, slug, mdFile, width, height, delay, options, parent, progressSender(event));
    });
  },

  open(AppContext, slug = null, mdFile = null) {
    const exportWin = new BrowserWindow({
      width: 680,
      height: 780,
      webPreferences: { preload: AppContext.preload }
    });
    exportWin.setMenu(null);
    const safeMdFile = String(mdFile || '').trim() || 'presentation.md';
    const query = slug
      ? `?slug=${encodeURIComponent(slug)}&md=${encodeURIComponent(safeMdFile)}`
      : '';
    const url = buildServerURL(AppContext.hostURL, AppContext.config.viteServerPort, AppContext.config.httpsEnabled);
    exportWin.loadURL(`${url}/admin/export.html${query}`);
  }
};

// Slide captures go to a fresh OS temp folder, never the presentation folder: presentations
// often live in OneDrive/Dropbox, whose sync clients lock new files and make cleanup fail (EPERM).
function makeCaptureDir(kind) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `revelation-${kind}-`));
}

// Cleanup is best-effort: a locked temp file must never turn a finished export into an error.
function removeCaptureDir(AppContext, dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    AppContext?.log?.(`⚠️ Could not remove export temp folder ${dir}: ${err.message}`);
  }
}

function normalizeExportDimensions(width, height, delay) {
  const safeWidth = Number.isFinite(Number(width)) && Number(width) > 0 ? Math.floor(Number(width)) : 1920;
  const safeHeight = Number.isFinite(Number(height)) && Number(height) > 0 ? Math.floor(Number(height)) : 1080;
  const safeDelay = Number.isFinite(Number(delay)) && Number(delay) >= 0 ? Number(delay) : 1;
  return { safeWidth, safeHeight, safeDelay };
}

// Reads the current slide's speaker notes as plain text, inside the rendered deck.
// Fragment-specific notes win over slide notes; media credits (.slide-attribution) are dropped.
// The notes are copied into a visible off-screen box so innerText keeps block line breaks.
const READ_CURRENT_NOTES_JS = `(() => {
  const slide = window.deck?.getCurrentSlide?.();
  if (!slide) return '';
  const fragment = slide.querySelector('.current-fragment');
  const pick = (el, ownAsides) => {
    const attr = el.getAttribute('data-notes');
    if (attr && attr.trim()) return { text: attr };
    const asides = ownAsides(el);
    if (asides.length) return { html: asides.map((a) => a.innerHTML).join('') };
    return null;
  };
  const found = (fragment && pick(fragment, (el) => Array.from(el.querySelectorAll('aside.notes'))))
    || pick(slide, (el) => Array.from(el.querySelectorAll('aside.notes')).filter((a) => !a.closest('.fragment')));
  if (!found) return '';
  if (found.text) return found.text.trim();
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:-100000px;top:0;width:800px;white-space:normal;';
  box.innerHTML = found.html;
  box.querySelectorAll('.slide-attribution, script, style').forEach((el) => el.remove());
  box.querySelectorAll('li').forEach((li) => li.insertBefore(document.createTextNode('• '), li.firstChild));
  document.body.appendChild(box);
  const text = box.innerText;
  box.remove();
  return text.replace(/\\u00a0/g, ' ').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
})()`;

// Number of capture steps: deck.next() walks through fragments, so each slide is one
// step plus one per distinct fragment index (fragments sharing an index appear together).
const COUNT_CAPTURE_STEPS_JS = `(() => {
  const fragmentsOn = window.deck.getConfig().fragments !== false;
  return window.deck.getSlides().reduce((sum, slide) => {
    if (!fragmentsOn) return sum + 1;
    const indices = new Set(Array.from(slide.querySelectorAll('.fragment'))
      .map((el) => el.getAttribute('data-fragment-index')));
    return sum + 1 + indices.size;
  }, 0);
})()`;

// options.collectNotes: also return each captured step's speaker notes (aligned with imagePaths).
// options.onProgress({ phase, done, total }): phase 'loading' while the deck opens, then
// 'capturing' after each captured step.
async function captureSlidesToImageFolder(AppContext, slug, mdFile, width, height, delay, exportDir, maxSlides = null, options = {}) {
  const { safeWidth, safeHeight, safeDelay } = normalizeExportDimensions(width, height, delay);
  const lang = String(
    AppContext?.config?.preferredPresentationLanguage ||
    AppContext?.config?.language ||
    ''
  ).trim().toLowerCase();
  const params = new URLSearchParams();
  params.set('p', mdFile);
  params.set('noShuffle', '1'); // captures are by slide position (thumbnail = first slide)
  params.set('noTransitions', '1'); // never capture mid-transition, whatever the deck uses
  params.set('staticOverlays', '1'); // credit line / AI badge present immediately, not fading in
  if (lang) {
    params.set('lang', lang);
  }
  const baseURL = buildServerURL(AppContext.hostURL, AppContext.config.viteServerPort, AppContext.config.httpsEnabled);
  const presURL = `${baseURL}/presentations_${AppContext.config.key}/${slug}/index.html?${params.toString()}`;
  fs.mkdirSync(exportDir, { recursive: true });

  const win = new BrowserWindow({
    show: false,
    width: safeWidth,
    height: safeHeight,
    webPreferences: { offscreen: true },
  });

  const imagePaths = [];
  const notes = [];
  const reportProgress = (progress) => {
    try {
      options.onProgress?.(progress);
    } catch {
      // Progress is best-effort; never let it break the capture.
    }
  };
  try {
    reportProgress({ phase: 'loading' });
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

    // Count capture steps (slides plus fragment steps) for progress only; the loop ends at
    // the real end of the deck. maxSlides is a hard cap (thumbnails use 1).
    const maxSteps = Number.isFinite(Number(maxSlides)) && Number(maxSlides) > 0
      ? Math.floor(Number(maxSlides))
      : null;
    const countedSteps = Number(await win.webContents.executeJavaScript(COUNT_CAPTURE_STEPS_JS)) || 1;
    const plannedSteps = maxSteps ? Math.min(countedSteps, maxSteps) : countedSteps;
    AppContext.log(`📸 Exporting about ${plannedSteps} step(s) as images...`);

    await new Promise((r) => setTimeout(r, 3000)); // wait for transitions

    for (let i = 1; i < 1000; i++) {
      const image = await win.webContents.capturePage();
      const imgPath = path.join(exportDir, `slide-${String(i).padStart(3, '0')}.jpg`);
      fs.writeFileSync(imgPath, image.toJPEG(90));
      imagePaths.push(imgPath);
      if (options.collectNotes) {
        notes.push(String(await win.webContents.executeJavaScript(READ_CURRENT_NOTES_JS) || ''));
      }
      AppContext.log(`🖼️ Saved ${imgPath}`);
      reportProgress({ phase: 'capturing', done: i, total: Math.max(plannedSteps, i) });
      if (maxSteps && i >= maxSteps) break;
      // Stop at the end of the deck: the last slide with no fragments left to show.
      if (await win.webContents.executeJavaScript('deck.isLastSlide() && !deck.availableFragments().next;')) break;
      await win.webContents.executeJavaScript('deck.next();');
      await new Promise((r) => setTimeout(r, 1000 * safeDelay)); // wait for transitions
    }

    return { success: true, exportDir, imagePaths, notes, width: safeWidth, height: safeHeight };
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

async function exportSlidesAsImages(AppContext, slug, mdFile, width, height, delay, thumbnail, onProgress = null) {
  if (thumbnail) {
    const thumbnailDir = makeCaptureDir('thumbnail');
    try {
      const capture = await captureSlidesToImageFolder(AppContext, slug, mdFile, width, height, delay, thumbnailDir, 1);
      const firstImage = capture?.imagePaths?.[0];
      if (!firstImage) {
        return { success: false, error: 'No slides captured for thumbnail.' };
      }
      const thumbnailName = deriveThumbnailName(mdFile);
      const imgPath = path.join(AppContext.config.presentationsDir, slug, thumbnailName);
      fs.copyFileSync(firstImage, imgPath);
      return { success: true, filePath: imgPath };
    } finally {
      removeCaptureDir(AppContext, thumbnailDir);
    }
  }

  const exportDir = makeCaptureDir('images');
  try {
    const capture = await captureSlidesToImageFolder(AppContext, slug, mdFile, width, height, delay, exportDir, null, { onProgress });
    if (!capture?.imagePaths?.length) {
      return { success: false, error: 'No slides captured for image export.' };
    }

    const { filePath } = await dialog.showSaveDialog({
      title: 'Export Slides as ZIP',
      defaultPath: `${slug}-images.zip`,
      filters: [{ name: 'Zip Files', extensions: ['zip'] }],
    });

    if (!filePath) return { success: true, canceled: true };

    onProgress?.({ phase: 'building' });
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
    removeCaptureDir(AppContext, exportDir);
  }
}

async function exportSlidesAsRasterPDF(AppContext, slug, mdFile, width, height, delay, onProgress = null) {
  const exportDir = makeCaptureDir('pdf');
  try {
    const capture = await captureSlidesToImageFolder(AppContext, slug, mdFile, width, height, delay, exportDir, null, { onProgress });
    if (!capture?.imagePaths?.length) {
      return { success: false, error: 'No slides captured for PDF export.' };
    }

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export PDF (Raster Mode)',
      defaultPath: `${slug}.pdf`,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    });

    if (canceled || !filePath) return { success: false, canceled: true };

    onProgress?.({ phase: 'building' });
    const pdfData = await renderImageSlidesToPDF(capture.imagePaths, capture.width, capture.height, exportDir);
    fs.writeFileSync(filePath, pdfData);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    removeCaptureDir(AppContext, exportDir);
  }
}

// PowerPoint export: one full-bleed slide image per captured step, with speaker notes.
// Slides are 7.5in tall (PowerPoint's standard height) and keep the export's aspect ratio.
const PPTX_SLIDE_HEIGHT_IN = 7.5;

function readPresentationTitle(AppContext, slug, mdFile) {
  try {
    const raw = fs.readFileSync(path.join(AppContext.config.presentationsDir, slug, mdFile), 'utf8');
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const meta = match ? require('js-yaml').load(match[1]) : null;
    return meta && typeof meta.title === 'string' ? meta.title : '';
  } catch {
    return '';
  }
}

// pptxgenjs writes each note as one text run with raw newlines, which PowerPoint shows
// on a single line. Split those runs into one <a:p> paragraph per line (blank lines
// become empty paragraphs) by closing and reopening the paragraph at each newline.
async function splitNotesIntoParagraphs(pptxBuffer) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(pptxBuffer);
  const notesFiles = Object.keys(zip.files).filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));
  for (const name of notesFiles) {
    const xml = await zip.file(name).async('string');
    const fixed = xml.replace(/<a:r>(<a:rPr[^>]*\/>)?<a:t>([^<]*\n[^<]*)<\/a:t><\/a:r>/g, (_match, rPr = '', text) =>
      text.split(/\r?\n/)
        .map((line) => (line ? `<a:r>${rPr}<a:t>${line}</a:t></a:r>` : ''))
        .join('</a:p><a:p>'));
    if (fixed !== xml) zip.file(name, fixed);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function exportSlidesAsPptx(AppContext, slug, mdFile, width, height, delay, options = {}, parentWindow = null, onProgress = null) {
  const includeNotes = options?.includeNotes !== false;
  // Ask where to save first, so nobody waits through a long capture only to cancel.
  const dialogOptions = {
    title: 'Export PowerPoint',
    defaultPath: `${slug}.pptx`,
    filters: [{ name: 'PowerPoint Presentations', extensions: ['pptx'] }],
  };
  const { canceled, filePath } = parentWindow
    ? await dialog.showSaveDialog(parentWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);
  if (canceled || !filePath) return { success: false, canceled: true };

  const exportDir = makeCaptureDir('pptx');
  try {
    const capture = await captureSlidesToImageFolder(
      AppContext, slug, mdFile, width, height, delay, exportDir, null, { collectNotes: includeNotes, onProgress }
    );
    if (!capture?.imagePaths?.length) {
      return { success: false, error: 'No slides captured for PowerPoint export.' };
    }

    onProgress?.({ phase: 'building' });
    const PptxGenJS = require('pptxgenjs');
    const pptx = new PptxGenJS();
    const slideWidthIn = Math.round(PPTX_SLIDE_HEIGHT_IN * (capture.width / capture.height) * 1000) / 1000;
    pptx.defineLayout({ name: 'REVELATION', width: slideWidthIn, height: PPTX_SLIDE_HEIGHT_IN });
    pptx.layout = 'REVELATION';
    pptx.title = readPresentationTitle(AppContext, slug, mdFile) || slug;

    capture.imagePaths.forEach((imgPath, index) => {
      const slide = pptx.addSlide();
      slide.background = { color: '000000' };
      slide.addImage({ path: imgPath, x: 0, y: 0, w: slideWidthIn, h: PPTX_SLIDE_HEIGHT_IN });
      const noteText = includeNotes ? capture.notes[index] : '';
      if (noteText) slide.addNotes(noteText);
    });

    const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' });
    fs.writeFileSync(filePath, includeNotes ? await splitNotesIntoParagraphs(pptxBuffer) : pptxBuffer);
    AppContext.log(`📊 Exported ${capture.imagePaths.length} slide(s) to ${filePath}`);
    return { success: true, filePath, count: capture.imagePaths.length };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    removeCaptureDir(AppContext, exportDir);
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
