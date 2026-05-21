const http = require('http');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const { findAvailablePort } = require('./serverManager');

const apiServer = {
  _server: null,
  _routes: {},  // { 'GET /api/bibletext/passage': handlerFn, 'POST /api/.../import': handlerFn }

  async start(AppContext) {
    if (AppContext.config.apiServerEnabled === false) return;
    this._routes = {};
    this._loadPluginRoutes(AppContext);
    const { register: registerCoreRoutes } = require('./presentationControlRoutes');
    registerCoreRoutes(this._routes, AppContext);

    const portResult = await findAvailablePort(AppContext.config.apiServerPort || 8001, 10);
    if (!portResult) {
      AppContext.error(`[apiServer] No available port found near ${AppContext.config.apiServerPort || 8001}`);
      return;
    }
    AppContext.config.apiServerPort = portResult.port;
    this._server = http.createServer((req, res) => this._handleRequest(req, res, AppContext));
    this._server.listen(portResult.port, '127.0.0.1', () => {
      AppContext.log(`[apiServer] Listening on http://127.0.0.1:${portResult.port}/api`);
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
    const method = req.method.toUpperCase();
    if (!['GET', 'POST'].includes(method)) return this._sendError(res, 405, 'Method Not Allowed');

    const routeKey = `${method} ${url.pathname}`;
    const handler = this._routes[routeKey];
    if (!handler) return this._sendError(res, 404, 'Not Found');

    const format = url.searchParams.get('format') === 'json' ? 'json' : 'yaml';
    const body = method === 'POST' ? await this._readBody(req) : null;
    try {
      const result = await handler(url.searchParams, res, body);
      if (result !== undefined) {
        this._sendData(res, 200, { success: true, data: result }, format);
      }
    } catch (err) {
      if (err.status) {
        this._sendError(res, err.status, err.message, format);
      } else {
        AppContext.error('[apiServer] Error:', err.message);
        this._sendError(res, 500, err.message, format);
      }
    }
  },

  _readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) return resolve(null);
        // Try JSON first, then URL-encoded form data.
        try { return resolve(JSON.parse(raw)); } catch {}
        try {
          const obj = Object.fromEntries(new URLSearchParams(raw));
          if (Object.keys(obj).length) return resolve(obj);
        } catch {}
        resolve(null);
      });
      req.on('error', reject);
    });
  },

  _callPlugin(AppContext, pluginName, invoke, data) {
    const plugin = AppContext.plugins?.[pluginName];
    if (!plugin?.api?.[invoke]) throw new Error(`Plugin '${pluginName}' method '${invoke}' not found`);
    return Promise.resolve(plugin.api[invoke](null, data));
  },

  _sendData(res, status, body, format = 'yaml') {
    let payload, contentType;
    if (format === 'json') {
      payload = JSON.stringify(body);
      contentType = 'application/json';
    } else {
      payload = yaml.dump(body, { lineWidth: -1 });
      contentType = 'text/yaml; charset=utf-8';
    }
    const buf = Buffer.from(payload, 'utf8');
    res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': buf.length });
    res.end(buf);
  },

  _sendError(res, status, message, format = 'yaml') {
    this._sendData(res, status, { error: message }, format);
  }
};

module.exports = { apiServer };
