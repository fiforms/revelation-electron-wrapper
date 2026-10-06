// IPC 'export-presentation-pdf' (slug, mdFile): loads the presentation's print view
// (`index.html?print-pdf&exportMode=1`) in a hidden offscreen window, waits for the deck to be
// ready plus a 3s settle, calls printToPDF, then asks where to save. Returns
// { success, filePath } or { success: false, canceled }. Registered from main.js.
// The hidden window is closed in a finally block, so a load or print failure rejects the IPC
// without leaking it. Raster/PPTX PDF export is in exportWindow.js.
const { BrowserWindow, ipcMain, dialog } = require('electron');
const { buildServerURL } = require('./serverUrl');
const { resolvePresentationFile } = require('./pathSafety');

const pdfExport = {
    register(ipcMain, AppContext) {
        ipcMain.handle('export-presentation-pdf', async (_event, slug, mdFile = 'presentation.md') => {
            const presentationsDir = AppContext.config.presentationsDir;
            resolvePresentationFile(presentationsDir, slug, mdFile);
            const key = AppContext.config.key;
            const baseURL = buildServerURL(AppContext.hostURL, AppContext.config.viteServerPort, AppContext.config.httpsEnabled);
            const url = `${baseURL}/presentations_${key}/${encodeURIComponent(slug)}/index.html?print-pdf&exportMode=1&p=${encodeURIComponent(mdFile)}`;

            const pdfWin = new BrowserWindow({
                show: false,
                webPreferences: {
                offscreen: true,
                },
            });

            let pdfData;
            try {
            await pdfWin.loadURL(url);

            AppContext.log(`📄 Exporting PDF for ${slug}...`);

            await pdfWin.webContents.executeJavaScript(`
                new Promise((resolve) => {
                    const POLL_MS = 250;
                    const SETTLE_MS = 3000;
                    const MAX_WAIT_MS = 15000;
                    const start = Date.now();
                    let done = false;

                    const finish = () => {
                      if (done) return;
                      done = true;
                      setTimeout(resolve, SETTLE_MS);
                    };

                    const hasSlides = () =>
                      document.querySelectorAll('.reveal .slides section').length >= 1;

                    const deckReady = () =>
                      !!(
                        window.deck &&
                        typeof window.deck.isReady === 'function' &&
                        window.deck.isReady()
                      );

                    const checkContent = () => {
                      if (deckReady() && hasSlides()) {
                        finish();
                        return;
                      }
                      if (Date.now() - start >= MAX_WAIT_MS) {
                        finish();
                        return;
                      }
                      setTimeout(checkContent, POLL_MS);
                    };

                    if (document.readyState === 'loading') {
                      document.addEventListener('DOMContentLoaded', checkContent, { once: true });
                      return;
                    }
                    checkContent();
                });
            `);

            pdfData = await pdfWin.webContents.printToPDF({
                printBackground: true,
                margins: { marginType: 'none' },
                preferCSSPageSize: true,
            });
            } finally {
                if (!pdfWin.isDestroyed()) pdfWin.close();
            }

            const { canceled, filePath } = await dialog.showSaveDialog({
                title: 'Export PDF',
                defaultPath: `${slug}.pdf`,
                filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
            });

            if (!canceled && filePath) {
                require('fs').writeFileSync(filePath, pdfData);
                return { success: true, filePath };
            }

            return { success: false, canceled };
        });
    } // register()
}

module.exports = { pdfExport };
