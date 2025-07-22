// misc ipcMain handlers

const { shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { saveConfig } = require('./configManager');


const otherEventHandlers = {
    register(ipcMain, AppContext) {

        // Handle opening external URLs
        ipcMain.on('open-external-url', (_event, href) => {
            AppContext.log('[main] Opening external URL:', href);
            shell.openExternal(href);
        });

        // Show the folder containing the presentation files
        ipcMain.handle('show-presentation-folder', async (_event, slug) => {
          const folder = path.join(AppContext.config.revelationDir,AppContext.config.presentationsDir, slug);
          if (fs.existsSync(folder)) {
            shell.openPath(folder); // Opens the folder in file browser
            return { success: true };
          } else {
            return { success: false, error: 'Folder not found' };
          }
        });

        // Handle opening the presentation in the default editor
        ipcMain.handle('edit-presentation', async (_event, slug, mdFile = 'presentation.md') => {
          const filePath = path.join(AppContext.config.revelationDir,AppContext.config.presentationsDir, slug, mdFile);
          if (fs.existsSync(filePath)) {
            return shell.openPath(filePath); // Opens in system default editor
          } else {
            throw new Error(`File not found: ${filePath}`);
          }
        });

        ipcMain.handle('get-app-config', () => AppContext.config);
        ipcMain.handle('save-app-config', (_event, updates) => {
          Object.assign(AppContext.config, updates);
          saveConfig(AppContext.config);
          return { success: true };
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

    }

}

module.exports = {
    otherEventHandlers
};