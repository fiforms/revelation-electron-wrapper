
const { BrowserWindow, ipcMain, dialog } = require('electron');

const pdfExport = {
    register(ipcMain, AppContext) { 
        ipcMain.handle('export-presentation-pdf', async (_event, slug, mdFile = 'presentation.md') => {
            const presentationsDir = AppContext.config.presentationsDir;
            const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/${presentationsDir}/${slug}/index.html?print-pdf&p=${mdFile}`;

            const pdfWin = new BrowserWindow({
                show: true,
                webPreferences: {
                offscreen: false,
                },
            });

            await pdfWin.loadURL(url);

            AppContext.log(`📄 Exporting PDF for ${slug}...`;

            await pdfWin.webContents.executeJavaScript(`
                new Promise((resolve) => {
                    const checkContent = () => {
                    const slides = document.querySelectorAll('.reveal .slides section');
                    if (slides.length > 1) setTimeout(resolve, 2000); // Wait for slides to render);
                        else setTimeout(checkContent, 300);
                    };
                    checkContent();
                });
            `);

            const pdfData = await pdfWin.webContents.printToPDF({
                // landscape: false,
                printBackground: true,
                marginsType: 0,
                pageSize: 'A4',
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