// Main Menu Template
const path = require('path');
const { app, shell } = require('electron');

const mainMenu = {
    register(ipcMain, AppContext) {

        const isMac = process.platform === 'darwin';

        const appMenu = isMac
          ? [{
            role: 'appMenu',
            submenu: [
              {
                label: 'About...',
                click: () => AppContext.callback('menu:about')
              },
              { type: 'separator' },
              {
                label: 'Settings...',
                accelerator: 'Cmd+,',
                click: () => AppContext.callback('menu:settings')
              },
              {
                label: 'Peer Presenter Pairing...',
                click: () => AppContext.callback('menu:peer-pairing')
              },
              {
                label: 'Reset All Settings and Plugins...',
                click: () => AppContext.callback('menu:reset-settings')
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }]
          : [{
            label: 'Revelation',
            submenu: [
              {
                label: 'About...',
                click: () => AppContext.callback('menu:about')
              },
              { type: 'separator' },
              {
                label: 'Settings...',
                click: () => AppContext.callback('menu:settings')
              },
              {
                label: 'Peer Presenter Pairing...',
                click: () => AppContext.callback('menu:peer-pairing')
              },
              {
                label: 'Reset All Settings and Plugins...',
                click: () => AppContext.callback('menu:reset-settings')
              },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }];

        AppContext.mainMenuTemplate.push(
          ...appMenu,
          {
            label: 'Presentation',
            submenu: [
              {
                label: 'New Presentation',
                click: () => AppContext.callback('menu:new-presentation')
              },
              {
                label: 'Import Presentation',
                click: () => AppContext.callback('menu:import-presentation')
              }
            ]
          },
          {
            label: 'Library',
            submenu: [
              {
                label: 'Show Media Library',
                click: () => AppContext.callback('menu:show-library')
              },
              {
                label: 'Show Presentation List',
                click: () => AppContext.callback('menu:show-presentation-list')
              },
              {
                label: 'Add Media to Library',
                click: () => AppContext.callback('menu:show-add-media-dialog')
              }
            ]
          },
          {
            label: 'Plugins',
            submenu: [
              {
                label: 'Install Plugin from ZIP…',
                click: () => AppContext.callback('menu:install-plugin-zip')
              },
              {
                label: 'Open Plugins Folder...',
                click: () => shell.openPath(AppContext.config.pluginFolder)
              },
            ],
          },
          {
            label: 'Help',
            submenu: [
              {
                label: 'Help Contents...',
                click: () => AppContext.callback('menu:help-contents-handout')
              },
              { type: 'separator' },
              {
                label: 'App Website',
                click: () => shell.openExternal('https://snapshots.vrbm.org/revelation-snapshot-presenter/')
              },
              {
                label: 'Regenerate Documentation',
                click: () => AppContext.callback('menu:regenerate-readme')
              },
              { type: 'separator' },
              ...(isMac ? [] : [{
                label: 'About...',
                click: () => AppContext.callback('menu:about')
              }]),
              {
                label: 'Debug',
                submenu: [
                  {
                    label: 'Open Log',
                    click: () => AppContext.callback('menu:open-debug-log')
                  },
                  {
                    label: 'Reset Log File',
                    click: () => AppContext.callback('menu:clear-debug-log')
                  },
                  {
                    label: 'Generate Theme Thumbnails...',
                    click: () => AppContext.callback('menu:generate-theme-thumbnails')
                  },
                  { type: 'separator' },
                  {
                    label: 'Copy Main Window URL',
                    click: async () => {
                      if (AppContext.win && !AppContext.win.isDestroyed()) {
                        const url = AppContext.win.webContents.getURL();
                        const { clipboard } = require('electron');
                        clipboard.writeText(url);
                        AppContext.log(`📋 Copied main window URL: ${url}`);
                      } else {
                        AppContext.error('Main window not available to copy URL.');
                      }
                    }
                  },
                  /*{
                    label: 'Open DevTools (Main Window)',
                    click: () => {
                      if (AppContext.win && !AppContext.win.isDestroyed()) {
                        AppContext.win.webContents.openDevTools({ mode: 'detach' });
                      } else {
                        AppContext.error('Main window not available to open DevTools.');
                      }
                    }
                  }*/
                ]
              }
            ]
          }
        );
    }
}

module.exports = { mainMenu };
