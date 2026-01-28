const { BrowserWindow, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const presentationBuilderWindow = {
  register(ipcMain, AppContext) {
    ipcMain.handle('open-presentation-builder', async (_event, slug, mdFile = 'presentation.md') => {
      if (!slug || !mdFile) {
        throw new Error('Missing slug or mdFile');
      }
      this.open(AppContext, slug, mdFile);
      return { success: true };
    });

    ipcMain.handle('save-presentation-markdown', async (_event, payload) => {
      const { slug, mdFile, content, targetFile } = payload || {};
      if (!slug || !mdFile) {
        throw new Error('Missing slug or mdFile');
      }
      if (typeof content !== 'string') {
        throw new Error('Missing markdown content');
      }

      const safeSlug = path.basename(String(slug));
      const safeMdFile = path.basename(String(mdFile));
      const safeTarget = targetFile ? path.basename(String(targetFile)) : null;
      const fileName = safeTarget || safeMdFile;

      if (!fileName.endsWith('.md')) {
        throw new Error('Target file must be a .md file');
      }

      const presDir = path.join(AppContext.config.presentationsDir, safeSlug);
      if (!fs.existsSync(presDir)) {
        throw new Error(`Presentation folder not found: ${safeSlug}`);
      }

      const fullPath = path.join(presDir, fileName);
      fs.writeFileSync(fullPath, content, 'utf-8');

      return { success: true, fileName };
    });

    ipcMain.handle('cleanup-presentation-temp', async (_event, payload) => {
      const { slug, tempFile } = payload || {};
      if (!slug || !tempFile) {
        throw new Error('Missing slug or tempFile');
      }
      const safeSlug = path.basename(String(slug));
      const safeTemp = path.basename(String(tempFile));
      if (!safeTemp.endsWith('.md')) {
        throw new Error('Temp file must be a .md file');
      }
      const presDir = path.join(AppContext.config.presentationsDir, safeSlug);
      const fullPath = path.join(presDir, safeTemp);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
      return { success: true };
    });
  },

  open(AppContext, slug, mdFile) {
    const builderWin = new BrowserWindow({
      width: 1400,
      height: 900,
      webPreferences: {
        preload: AppContext.preload,
      },
    });
    builderWin.setMenu(null);
    builderWin.webContents.setWindowOpenHandler(({ url }) => {
      if (url) {
        shell.openExternal(url).catch((err) => {
          AppContext.error('Failed to open external link:', err.message);
        });
      }
      return { action: 'deny' };
    });

    const url = `/admin/builder.html?dir=presentations_${AppContext.config.key}&slug=${slug}&md=${mdFile}`;
    builderWin.loadURL(`http://${AppContext.hostURL}:${AppContext.config.viteServerPort}${url}`);

    let allowClose = false;
    builderWin.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'F12') {
        builderWin.webContents.openDevTools({ mode: 'detach' });
      }
    });

    builderWin.on('close', async (event) => {
      if (allowClose || builderWin.isDestroyed()) return;
      event.preventDefault();

      let isDirty = false;
      try {
        isDirty = await builderWin.webContents.executeJavaScript(
          'window.__builderGetDirty ? window.__builderGetDirty() : false',
          true
        );
      } catch (err) {
        AppContext.error('Failed to query builder dirty state:', err.message);
      }

      if (!isDirty) {
        allowClose = true;
        builderWin.close();
        return;
      }

      const result = await dialog.showMessageBox(builderWin, {
        type: 'warning',
        buttons: ['Cancel', 'Discard Changes'],
        defaultId: 0,
        cancelId: 0,
        message: 'You have unsaved changes. Are you sure you want to close and lose your changes?',
      });

      if (result.response === 1) {
        allowClose = true;
        builderWin.close();
      }
    });
  }
};

module.exports = { presentationBuilderWindow };
