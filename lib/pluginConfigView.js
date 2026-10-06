// Which parts of a plugin's config may reach a browser. Pure Node (no Electron), so tests can load it.
//
// A plugin's `config` holds its Settings values and can include credentials (an API key, a password, a
// pairing token). plugins.json, which the local server publishes at /plugins_<key>/plugins.json, and the
// plugin list handed to builder/Add Media pages are visible to every page and every holder of a
// presentation link, so they must not carry those values.
//
// Mark a credential with `secret: true` on its configTemplate field. For a key that has no template
// field, list it in the plugin's `privateConfigKeys` array. Everything else stays visible, because
// plugin client code reads its settings from the config it is given (slidecontrol, for one, reads
// `allowControlFromAnyClient`, which has no Settings field).
//
// Settings itself still needs the full config: it edits the values and saves the whole object back, so
// `get-plugin-list` returns everything only when asked with `includeSecrets: true` (see pluginDirector).
// Background: doc/dev/KNOWN_ISSUES.md (S2) and doc/dev/PLUGINS.md.
function secretConfigKeys(plugin) {
  const keys = new Set(Array.isArray(plugin?.privateConfigKeys) ? plugin.privateConfigKeys : []);
  for (const field of Array.isArray(plugin?.configTemplate) ? plugin.configTemplate : []) {
    if (field && field.secret === true && typeof field.name === 'string') keys.add(field.name);
  }
  return keys;
}

// A copy of plugin.config without the secret keys (the same object when there is nothing to remove).
function browserSafeConfig(plugin) {
  const config = plugin?.config;
  if (!config || typeof config !== 'object') return config;
  const hidden = secretConfigKeys(plugin);
  if (!hidden.size) return config;
  const safe = {};
  for (const key of Object.keys(config)) {
    if (!hidden.has(key)) safe[key] = config[key];
  }
  return safe;
}

module.exports = { secretConfigKeys, browserSafeConfig };
