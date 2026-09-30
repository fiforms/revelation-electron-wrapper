const { app } = require('electron');

const PLUGIN_NAME = 'infopanel';

function getConfiguredHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const infoPanelPlugin = {
  priority: 110,
  exposeToBrowser: true,
  clientHookJS: 'client.js',
  defaultEnabled: false,
  config: {},
  loggedIn: '',
  configTemplate: [
    {
      name: 'url',
      type: 'string',
      description: 'URL to display in the info panel (shown on Confidence Monitor and Notes views).',
      default: ''
    },
    {
      name: 'username',
      type: 'string',
      description: 'Username for HTTP Basic Authentication. Leave blank if the site does not require authentication.',
      default: ''
    },
    {
      name: 'password',
      type: 'string',
      description: 'Password for HTTP Basic Authentication. Stored in plain text in config.json.',
      default: ''
    },
    {
      name: 'panelPosition',
      type: 'string',
      description: 'Where to dock the info panel on the Confidence Monitor screen.',
      default: 'bottom',
      dropdownsrc: () => [
        { label: 'Bottom', value: 'bottom' },
        { label: 'Right', value: 'right' }
      ]
    },
    {
      name: 'panelSize',
      type: 'number',
      description: 'Panel size as a percentage of the screen (height for Bottom, width for Right). Default: 25.',
      default: 25
    }
  ],

  register(AppContext) {
    this.AppContext = AppContext;

    // Attach a login handler to every BrowserWindow as it is created.
    // This covers the main presentation window, the notes pop-out window,
    // and any additional-screen windows — including iframes inside them.
    app.on('browser-window-created', (_event, win) => {
      win.webContents.on('login', (event, _details, authInfo, callback) => {
        if (this.loggedIn === authInfo.host) {
          // Already logged in to this host, so just provide the credentials again.
          console.log(`[infopanel-plugin] Refusing to login to ${authInfo.host} again (already logged in)`);
          event.preventDefault();
          return;
        }
        const configuredUrl = String(this.config.url || '').trim();
        const username = String(this.config.username || '').trim();

        if (!configuredUrl || !username) return;

        const hostname = getConfiguredHostname(configuredUrl);
        if (!hostname || authInfo.host !== hostname) return;

        event.preventDefault();
        console.log(`[infopanel-plugin] Providing credentials for ${authInfo.host} (username: ${username})`);
        this.loggedIn = authInfo.host;
        callback(username, String(this.config.password || ''));
      });
    });

    AppContext.log('[infopanel-plugin] Registered');
  }
};

module.exports = infoPanelPlugin;
