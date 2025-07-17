// Main Menu Template

const mainMenu = {
    register(ipcMain, AppContext) {
        AppContext.mainMenuTemplate.push(
          {
            label: 'File',
            submenu: [
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
            ]
          },
          {
            label: 'Help',
            submenu: [
              {
                label: 'About...',
                click: () => AppContext.callback('menu:about')
              }
            ]
          }
        );
    }
}

module.exports = { mainMenu };