// plugins/widgets/plugin.js
//
// Overlay Widgets: `:widget:` markdown blocks place live widgets (calendar, clock,
// weather, hello) from the plugins/widgets/overlaywidgets git submodule on top of a slide.
//
// Hooks / manifest fields: priority 106, clientHookJS 'client.js'
// (+ validate.js, shared with the main process), exposeToBrowser true, no config keys.
// IPC: api['fetch'] (admin/builder preview) and presentationApi['fetch'] (presentation
// windows) -> endpoint-server.fetchEndpointSafe({widget, endpoint, params, args}).
// External services: whatever HTTPS endpoints a widget manifest declares (e.g. an iCal feed,
// weather API), fetched in the main process with SSRF protection (public addresses only).
// Offline export: offline.js. Do not edit inside overlaywidgets/ (separate repo).

const path = require('path');
const { fetchEndpointSafe } = require(path.join(__dirname, 'endpoint-server'));

// The widget "host" runs here in the main process: the renderer asks for an
// endpoint by name and this makes the request. See endpoint-server.js.
const fetchHandler = async (_event, data) => fetchEndpointSafe(data);

const widgetsPlugin = {
  priority: 106,
  exposeToBrowser: true,
  clientHookJS: 'client.js',
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
