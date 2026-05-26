// Main Menu Template
const { shell } = require('electron');

function buildProfilesSubmenu(AppContext) {
  const profiles = Array.isArray(AppContext.profileList) ? AppContext.profileList : ['Default'];
  const active = typeof AppContext.config?.profile === 'string' && AppContext.config.profile.trim()
    ? AppContext.config.profile.trim()
    : 'Default';

  const profileItems = profiles.map((name) => ({
    label: name,
    type: 'radio',
    checked: name === active,
    click: () => {
      if (name !== active) AppContext.callback('menu:switch-profile', name);
    }
  }));

  return [
    ...profileItems,
    { type: 'separator' },
    {
      label: 'New Profile...',
      click: () => AppContext.callback('menu:save-as-profile')
    },
    {
      label: 'Reset Current Profile',
      click: () => AppContext.callback('menu:reset-profile')
    },
    active === 'Default' ? { type: 'separator' } :
    {
      label: 'Delete Current Profile',
      click: () => AppContext.callback('menu:delete-profile')
    }
  ];
}

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
                label: 'Profiles',
                submenu: buildProfilesSubmenu(AppContext)
              },
              {
                label: 'Peer Presenter Pairing...',
                click: () => AppContext.callback('menu:peer-pairing')
              },
              {
                label: 'Reset Plugins...',
                click: () => AppContext.callback('menu:reset-plugins')
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
                label: 'Profiles',
                submenu: buildProfilesSubmenu(AppContext)
              },
              {
                label: 'Peer Presenter Pairing...',
                click: () => AppContext.callback('menu:peer-pairing')
              },
              {
                label: 'Reset Plugins...',
                click: () => AppContext.callback('menu:reset-plugins')
              },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }];

        AppContext.mainMenuTemplate.push(
          ...appMenu,
          {
            label: 'Edit',
            submenu: [
              { role: 'undo' },
              { role: 'redo' },
              { type: 'separator' },
              { role: 'cut' },
              { role: 'copy' },
              { role: 'paste' },
              ...(isMac ? [
                { role: 'pasteAndMatchStyle' },
                { type: 'separator' },
                { role: 'delete' },
                { type: 'separator' },
                { role: 'selectAll' }
              ] : [
                { type: 'separator' },
                { role: 'selectAll' }
              ])
            ]
          },
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
              },
              { type: 'separator' },
              {
                label: 'Peer Screens',
                submenu: [
                  {
                    label: 'Open Screens',
                    click: () => AppContext.callback('menu:open-screens')
                  },
                  {
                    label: 'End Remote Presentation',
                    click: () => AppContext.callback('menu:end-remote-presentation')
                  },
                  {
                    label: 'Close Screens',
                    click: () => AppContext.callback('menu:close-screens')
                  }
                ]
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
                  {
                    label: 'Install Markdown Test Presentation',
                    click: () => AppContext.callback('menu:install-markdown-test-presentation')
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
