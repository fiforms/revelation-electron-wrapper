const fs = require('fs');
const path = require('path');

function listPluginDirectories(pluginFolder) {
  if (!pluginFolder || !fs.existsSync(pluginFolder)) return [];
  try {
    return fs.readdirSync(pluginFolder, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
  } catch (_err) {
    return [];
  }
}

function getDefaultEnabledPluginIds(pluginFolder) {
  const pluginIds = [];
  for (const pluginId of listPluginDirectories(pluginFolder)) {
    const pluginPath = path.join(pluginFolder, pluginId, 'plugin.js');
    if (!fs.existsSync(pluginPath)) continue;
    try {
      const plugin = require(pluginPath);
      if (plugin?.defaultEnabled === true) {
        pluginIds.push(pluginId);
      }
    } catch (err) {
      console.warn(`Failed to read bootstrap metadata for plugin "${pluginId}": ${err.message}`);
    }
  }
  return pluginIds;
}

module.exports = {
  getDefaultEnabledPluginIds
};
