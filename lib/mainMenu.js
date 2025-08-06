// Main Menu Template

const mainMenu = {
    register(ipcMain, AppContext) {

        const isMac = process.platform === 'darwin';

        AppContext.mainMenuTemplate.push(
          {
            label: 'File',
            submenu: [
              ...(isMac ? [{
                label: 'Reopen Main Window',
                accelerator: 'Cmd+Shift+R',
                click: () => {
                  if (!AppContext.win || AppContext.win.isDestroyed()) {
                    AppContext.log('🔄 Reopening main window from menu');
                    AppContext.callback('menu:create-main-window'); 
                  } else {
                    AppContext.win.show();
                  }
                }
              }] : []),
              {
                label: 'New Presentation',
                click: () => AppContext.callback('menu:new-presentation')
              },
              {
                label: 'Import Presentation (REVELation ZIP)',
                click: () => AppContext.callback('menu:import-presentation')
              },
              { type: 'separator' },
              { role: 'quit' }
            ]
          },
          {
            label: 'Presentation',
            submenu: [
              {
                label: 'Localhost Mode',
                type: 'radio',
                checked: AppContext.currentMode === 'localhost',
                click: () => AppContext.callback('menu:switch-mode', 'localhost')
              },
              {
                label: 'Network Mode',
                type: 'radio',
                checked: AppContext.currentMode === 'network',
                click: () => AppContext.callback('menu:switch-mode', 'network')
              },
              { type: 'separator' },
              {
                label: 'Settings...',
                click: () => AppContext.callback('menu:settings')
              },
              {
                label: 'Reset All Settings...',
                click: () => AppContext.callback('menu:reset-settings')
              },
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
            submenu: [],
          },
          {
            label: 'Help',
            submenu: [
              {
                label: 'About...',
                click: () => AppContext.callback('menu:about')
              },
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
                  }
                ]
              },
            ]
          }
        );
    }
}

module.exports = { mainMenu };