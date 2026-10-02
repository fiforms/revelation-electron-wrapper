const path = require('path');
const { fetchEndpointSafe } = require(path.join(__dirname, 'endpoint-server'));

// The widget "host" runs here in the main process: the renderer asks for an
// endpoint by name and this makes the request. See endpoint-server.js.
const fetchHandler = async (_event, data) => fetchEndpointSafe(data);

const widgetsPlugin = {
  priority: 106,
  exposeToBrowser: true,
  clientHookJS: 'client.js',
  defaultEnabled: false,
  config: {},
  configTemplate: [],

  register(AppContext) {
    AppContext.log('[widgets-plugin] Registered');
  },

  // presentationApi: callable from presentation windows; api: from the admin
  // window (the builder preview reaches it through its parent frame).
  presentationApi: { fetch: fetchHandler },
  api: { fetch: fetchHandler }
};

module.exports = widgetsPlugin;
