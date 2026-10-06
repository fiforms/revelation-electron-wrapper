// lib/revelationModules.js — load a pure module from the revelation submodule's server/ folder.
// For code that both repos must share (today: server/peer-protocol.js, used by lib/peerAuth.js), so
// there is one implementation instead of a hand-kept copy on each side.
//   requireRevelationServerModule(name)      require('<revelation>/server/<name>.js')
//   resolveRevelationServerModule(name, opts) the path it would load; throws, listing every place tried
// Where it looks, in order:
//   1. <app>/revelation/server/<name>.js   a checkout, and the test suite (lib/ sits beside revelation/)
//   2. <process.resourcesPath>/revelation/server/<name>.js   a packaged app (electron-builder
//      extraResources; lib/ is inside app.asar, which does not contain revelation/)
// It deliberately does NOT use config.revelationDir / the <userData>/resources mirror: lib modules
// load at startup, before main.js re-syncs that mirror, so after an update the mirror can still be
// the old version or lack the file. The bundled copy always matches this app's version.
// Only modules that need nothing beyond Node built-ins belong here. `opts` ({ libDir, resourcesPath,
// exists }) exists for tests.
const fs = require('fs');
const path = require('path');

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

function resolveRevelationServerModule(name, opts = {}) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error(`Invalid revelation server module name: ${JSON.stringify(name)}`);
  const libDir = opts.libDir || __dirname;
  const resourcesPath = opts.resourcesPath !== undefined ? opts.resourcesPath : process.resourcesPath;
  const exists = opts.exists || fs.existsSync;
  const file = path.join('server', `${name}.js`);
  const tried = [
    path.join(libDir, '..', 'revelation', file),
    resourcesPath ? path.join(resourcesPath, 'revelation', file) : null
  ].filter(Boolean);
  const found = tried.find((candidate) => exists(candidate));
  if (!found) {
    throw new Error(`revelation/server/${name}.js not found. Looked in:\n  ${tried.join('\n  ')}`);
  }
  return found;
}

function requireRevelationServerModule(name, opts) {
  return require(resolveRevelationServerModule(name, opts));
}

module.exports = { requireRevelationServerModule, resolveRevelationServerModule };
