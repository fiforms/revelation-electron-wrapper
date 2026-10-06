// Optional local control API (doc/API_REFERENCE.md). A SECOND HTTP server, separate from the Vite
// server: binds 127.0.0.1 only, default port 8900 (config.apiServerPort), enabled unless
// config.apiServerEnabled === false. Started/stopped from main.js.
// Routing: a flat map { 'METHOD /api/path': async (searchParams, res, body) => data } filled by
// presentationControlRoutes.register() and by each enabled plugin's api-server.js
// (register(routes, callPlugin, AppContext)). Only GET and POST are accepted.
// Auth: config.key via ?key= or the x-api-key header (constant-time compare, no rate limit). The ?key=
// form is deliberate: the plugin API docs and existing integrations use it.
// Request bodies (POST) are capped at MAX_BODY_BYTES; larger ones get 413.
// Responses are wrapped as { success: true, data } and serialized as YAML by default; pass
// ?format=json for JSON. Handlers may throw { status, message } to return a specific HTTP error.
// A handler that returns undefined is expected to have written the response itself.
const http = require('http');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const crypto = require('crypto');
const { findAvailablePort, DEFAULT_API_PORT } = require('./serverManager');

const MAX_BODY_BYTES = 1024 * 1024; // control requests are tiny JSON/form bodies

// Constant-time string comparison (hashing first makes the lengths equal).
function keysMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
  const digest = (value) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(provided), digest(expected));
}

const apiServer = {
  _server: null,
  _routes: {},  // { 'GET /api/bibletext/passage': handlerFn, 'POST /api/.../import': handlerFn }

  async start(AppContext) {
    if (AppContext.config.apiServerEnabled === false) return;
    this._routes = {};
    this._loadPluginRoutes(AppContext);
    const { register: registerCoreRoutes } = require('./presentationControlRoutes');
    registerCoreRoutes(this._routes, AppContext);

    const preferredPort = AppContext.config.apiServerPort || DEFAULT_API_PORT;
    // Never land on the Vite server's port. By the time this runs, startServers
    // has already resolved config.viteServerPort to the port Vite actually took.
    const portResult = await findAvailablePort(preferredPort, 10, [AppContext.config.viteServerPort]);
    if (!portResult) {
      AppContext.error(`[apiServer] No available port found near ${preferredPort}`);
      return;
    }
    if (portResult.changed) {
      AppContext.log(`[apiServer] Port ${preferredPort} unavailable; using ${portResult.port} for this session.`);
      // Keep the user's configured port; only the live value moves. See the
      // matching note in serverManager.startServers.
      if (!Number.isFinite(Number(AppContext.config.configuredApiServerPort))) {
        AppContext.config.configuredApiServerPort = preferredPort;
      }
    }
    AppContext.config.apiServerPort = portResult.port;
    this._server = http.createServer((req, res) => {
      // _handleRequest handles its own errors; this is the last line of defence against an
      // unhandled rejection from the server callback.
      this._handleRequest(req, res, AppContext).catch((err) => {
        AppContext.error('[apiServer] Unhandled error:', err.message);
        if (!res.headersSent) this._sendError(res, 500, 'Internal Server Error');
        else res.end();
      });
    });
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
    // Packaged builds keep plugins in resources/plugins (extraResources), not
    // inside app.asar, so use the folder pluginDirector resolved at startup.
    const pluginsRoot = AppContext.config.pluginFolder || path.join(__dirname, '..', 'plugins');
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
    if (!keysMatch(key, AppContext.config.key)) return this._sendError(res, 401, 'Unauthorized');
    const method = req.method.toUpperCase();
    if (!['GET', 'POST'].includes(method)) return this._sendError(res, 405, 'Method Not Allowed');

    const routeKey = `${method} ${url.pathname}`;
    const handler = this._routes[routeKey];
    if (!handler) return this._sendError(res, 404, 'Not Found');

    const format = url.searchParams.get('format') === 'json' ? 'json' : 'yaml';
    try {
      const body = method === 'POST' ? await this._readBody(req) : null;
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
      let size = 0;
      let rejected = false;
      req.on('data', c => {
        if (rejected) return; // keep draining so the 413 can be delivered
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          rejected = true;
          chunks.length = 0;
          reject({ status: 413, message: 'Request body too large' });
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (rejected) return;
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
      req.on('error', (err) => { if (!rejected) reject({ status: 400, message: `Bad request: ${err.message}` }); });
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
