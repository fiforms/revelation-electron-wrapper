const { BrowserWindow, screen, Menu } = require('electron');

const handoutWindow = {
  register(ipcMain, AppContext) {
    ipcMain.handle('open-handout', (_event, slug, mdFile = 'presentation.md') => {
      return this.open(AppContext, slug, mdFile);
    });

    AppContext.callbacks['menu:handout-view'] = () => {
      // Use some defaults or store last opened
      this.open(AppContext, 'your-slug-here', 'presentation.md'); 
    };
  },

  open(AppContext, slug, mdFile) {
    const displays = screen.getAllDisplays();
    const targetDisplay = displays[AppContext.config.preferredDisplay] || displays[0];

    const win = new BrowserWindow({
      x: targetDisplay.bounds.x + 50,
      y: targetDisplay.bounds.y + 50,
      width: 1000,
      height: 800,
      webPreferences: { preload: AppContext.preload }
    });

    const p_key = AppContext.config.key;
    const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/presentations_${p_key}/${slug}/handout?p=${mdFile}`;
    win.loadURL(url);
    win.webContents.on('did-finish-load', () => {
      win.webContents.insertCSS('body { margin-top: 2rem; }'); // optional tweak
    });

    // Add print menu
    win.setMenu(Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
            {
                label: 'Print',
                accelerator: 'CmdOrCtrl+P',
                click: () => win.webContents.print()
            },
            {
                label: 'Export PDF',
                click: async () => {
                    const { dialog } = require('electron');
                    try {
                    const { canceled, filePath } = await dialog.showSaveDialog({
                        title: 'Save Handout as PDF',
                        defaultPath: `${slug}-handout.pdf`,
                        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
                    });

                    if (canceled || !filePath) {
                        console.log('❌ PDF export canceled');
                        return;
                    }

                    const pdfData = await win.webContents.printToPDF({
                        printBackground: true,
                        marginsType: 1,
                        pageSize: 'A4',
                        landscape: false,
                    });

                    const fs = require('fs');
                    fs.writeFileSync(filePath, pdfData);
                    console.log(`✅ PDF saved to: ${filePath}`);
                    } catch (err) {
                    console.error('❌ PDF export failed:', err.message);
                    }
                }
            },
          { role: 'close' }
        ]
      }
    ]));
  }
};


module.exports = { handoutWindow };
