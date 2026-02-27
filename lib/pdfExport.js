
const { BrowserWindow, ipcMain, dialog, shell } = require('electron');

const pdfExport = {
    register(ipcMain, AppContext) { 
        ipcMain.handle('export-presentation-pdf', async (_event, slug, mdFile = 'presentation.md') => {
            const presentationsDir = AppContext.config.presentationsDir;
            const key = AppContext.config.key;
            const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/presentations_${key}/${slug}/index.html?print-pdf&exportMode=1&p=${mdFile}`;

            // The code to print isn't working properly in the Electron environment,
            // so we open the URL in the default browser instead.
            // This is a workaround to allow users to export PDFs without issues.
            
            /*
            AppContext.log(`📄 Exporting PDF for ${slug}... Opening in default browser: ${url}`);
            shell.openExternal(url);

            return true;
            */

            const pdfWin = new BrowserWindow({
                show: false,
                webPreferences: {
                offscreen: true,
                },
            });

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

            const pdfData = await pdfWin.webContents.printToPDF({
                // landscape: false,
                printBackground: true,
                marginsType: 1, // no margins
                preferCSSPageSize: true,
            });

            pdfWin.close();

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
