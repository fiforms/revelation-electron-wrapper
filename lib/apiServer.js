const http = require('http');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const { findAvailablePort } = require('./serverManager');

const apiServer = {
  _server: null,
  _routes: {},  // { 'GET /api/bibletext/passage': handlerFn }

  async start(AppContext) {
    if (AppContext.config.apiServerEnabled === false) return;
    this._routes = {};
    this._loadPluginRoutes(AppContext);

    const port = await findAvailablePort(AppContext.config.apiServerPort || 8001, 10);
    AppContext.config.apiServerPort = port;
    this._server = http.createServer((req, res) => this._handleRequest(req, res, AppContext));
    this._server.listen(port, '127.0.0.1', () => {
      AppContext.log(`[apiServer] Listening on http://127.0.0.1:${port}/api`);
    });
  },

  stop() {
    this._server?.close();
    this._server = null;
    this._routes = {};
  },

  _loadPluginRoutes(AppContext) {
    const pluginsRoot = path.join(__dirname, '..', 'plugins');
    for (const pluginName of Object.keys(AppContext.plugins || {})) {
      const apiFile = path.join(pluginsRoot, pluginName, 'api-server.js');
      if (!fs.existsSync(apiFile)) continue;
      try {
        const pluginApiModule = require(apiFile);
        const callPlugin = (invoke, data) => this._callPlugin(AppContext, pluginName, invoke, data);
        pluginApiModule.register(this._routes, callPlugin, AppContext);
        AppContext.log(`[apiServer] Loaded routes from plugin: ${pluginName}`);
      } catch (err) {
        AppContext.error(`[apiServer] Failed to load api-server.js for plugin '${pluginName}':`, err.message);
      }
    }
  },

  async _handleRequest(req, res, AppContext) {
    const url = new URL(req.url, 'http://localhost');
    const key = url.searchParams.get('key') || req.headers['x-api-key'];
    if (key !== AppContext.config.key) return this._sendError(res, 401, 'Unauthorized');
    if (req.method !== 'GET') return this._sendError(res, 405, 'Method Not Allowed');

    const routeKey = `GET ${url.pathname}`;
    const handler = this._routes[routeKey];
    if (!handler) return this._sendError(res, 404, 'Not Found');

    try {
      const result = await handler(url.searchParams, res);
      if (result !== undefined) {
        this._sendJSON(res, 200, { success: true, data: result });
      }
    } catch (err) {
      if (err.status) {
        this._sendError(res, err.status, err.message);
      } else {
        AppContext.error('[apiServer] Error:', err.message);
        this._sendError(res, 500, err.message);
      }
    }
  },

  _callPlugin(AppContext, pluginName, invoke, data) {
    const plugin = AppContext.plugins?.[pluginName];
    if (!plugin?.api?.[invoke]) throw new Error(`Plugin '${pluginName}' method '${invoke}' not found`);
    return Promise.resolve(plugin.api[invoke](null, data));
  },

  _sendJSON(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
    res.end(payload);
  },

  _sendError(res, status, message) {
    this._sendJSON(res, status, { error: message });
  }
};

module.exports = { apiServer };
