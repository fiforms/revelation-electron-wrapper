// misc ipcMain handlers

const { shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { saveConfig } = require('./configManager');
const { app } = require('electron');


const otherEventHandlers = {
    register(ipcMain, AppContext) {

        // Handle opening external URLs
        ipcMain.on('open-external-url', (_event, href) => {
            AppContext.log('[main] Opening external URL:', href);
            shell.openExternal(href);
        });

        // Show the folder containing the presentation files
        ipcMain.handle('show-presentation-folder', async (_event, slug) => {
          const folder = path.join(AppContext.config.presentationsDir, slug);
          if (fs.existsSync(folder)) {
            shell.openPath(folder); // Opens the folder in file browser
            return { success: true };
          } else {
            return { success: false, error: 'Folder not found' };
          }
        });

        // Handle opening the presentation in the default editor
        ipcMain.handle('edit-presentation', async (_event, slug, mdFile = 'presentation.md') => {
          const filePath = path.join(AppContext.config.presentationsDir, slug, mdFile);
          if (fs.existsSync(filePath)) {
            return shell.openPath(filePath); // Opens in system default editor
          } else {
            throw new Error(`File not found: ${filePath}`);
          }
        });

        ipcMain.handle('get-app-config', () => {
          return {
            ...AppContext.config,
            allPluginFolders: AppContext.allPluginFolders || []
          };
        });

        ipcMain.handle('save-app-config', (_event, updates) => {
          Object.assign(AppContext.config, updates);
          saveConfig(AppContext.config);
          return { success: true };
        });

        ipcMain.handle('select-presentations-dir', async () => {
          const { dialog } = require('electron');
          const { canceled, filePaths } = await dialog.showOpenDialog({
            title: 'Select Presentations Folder',
            properties: ['openDirectory']
          });

          if (canceled || !filePaths.length) return null;
          return filePaths[0];
        });

        ipcMain.handle('save-current-presentation', async (_event, data) => {
          try {
            const storeFile = path.join(app.getPath('userData'), 'currentPresentation.json');
            fs.writeFileSync(storeFile, JSON.stringify(data, null, 2));
            AppContext.log(`💾 Saved current presentation: ${data.slug}`);
            return { success: true };
          } catch (err) {
            AppContext.error('Failed to save current presentation:', err);
            return { success: false, error: err.message };
          }
        });

        ipcMain.handle('get-current-presentation', async () => {
          try {
            const storeFile = path.join(app.getPath('userData'), 'currentPresentation.json');
            if (fs.existsSync(storeFile)) {
              const data = JSON.parse(fs.readFileSync(storeFile, 'utf-8'));
              return data;
            }
            return null;
          } catch (err) {
            AppContext.error('Failed to load current presentation:', err);
            return null;
          }
        });

        ipcMain.handle('clear-current-presentation', async () => {
          try {
            const storeFile = path.join(app.getPath('userData'), 'currentPresentation.json');
            if (fs.existsSync(storeFile)) fs.unlinkSync(storeFile);
            AppContext.log('🗑️ Cleared current presentation');
            return { success: true };
          } catch (err) {
            AppContext.error('Failed to clear current presentation:', err);
            return { success: false, error: err.message };
          }
        });

        ipcMain.handle('get-display-list', () => {
          const { screen } = require('electron');
          return screen.getAllDisplays();
        });

        ipcMain.handle('getAvailableThemes', async () => {
          const themeDir = path.resolve(__dirname, '../revelation/css');
          const exclude = ['handout.css', 'presentations.css']; // add more if needed
          const themes = fs.readdirSync(themeDir)
            .filter(file => file.endsWith('.css') && !exclude.includes(file));
          return themes;
        });

        AppContext.callbacks['menu:open-debug-log'] = () => {
          return shell.openPath(AppContext.config.logFile);
        }
        AppContext.callbacks['menu:clear-debug-log'] = () => {
          return AppContext.resetLog();
        }

        AppContext.callbacks['menu:show-library'] = () => {
          const key = AppContext.config.key;
          const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/media-library.html?key=${key}`
          AppContext.win.loadURL(url);
        }

        AppContext.callbacks['menu:show-presentation-list'] = () => {
          const key = AppContext.config.key;
          const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/presentations.html?key=${key}`
          AppContext.win.loadURL(url);
        }
    }

}

module.exports = {
    otherEventHandlers
};