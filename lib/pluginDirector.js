
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const pluginDirector = {

    pluginFolder: app.isPackaged
      ? path.join(process.resourcesPath, 'plugins')
      : path.join(__dirname, '..', 'plugins'),

    register(ipcMain, AppContext) {

        ipcMain.handle('plugin-trigger', async (_event, pluginName, invoke, data) => {
            if(!AppContext.plugins[pluginName]) {
                AppContext.error(`⚠️ Failed to invoke ${invoke} on plugin "${pluginName}": Plugin Not Found`)
                return 1;
            }
            if(!AppContext.plugins[pluginName].api || !AppContext.plugins[pluginName].api[invoke]) {
                AppContext.error(`⚠️ Failed to invoke ${invoke} on plugin "${pluginName}": Plugin Not Found`)
                return 1;
            }
            try {
                return await AppContext.plugins[pluginName].api[invoke](_event,data);
            } catch (err) {
                AppContext.error(`❌ Failed to invoke ${invoke} on plugin "${pluginName}": ${err.message}`)
            }
        });

        ipcMain.handle('get-plugin-list', function () {
            const pluginList = {};

            for (const [name, plugin] of Object.entries(AppContext.plugins)) {
                pluginList[name] = {};
                pluginList[name].baseURL = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/plugins_${AppContext.config.key}/${name}`;
                pluginList[name].priority = plugin.priority;
                if (typeof plugin.clientHookJS === 'string') {
                    pluginList[name].clientHookJS = plugin.clientHookJS;
                }
            }
            return pluginList;
        });

        const pluginDirs = fs.readdirSync(this.pluginFolder, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory());

        for (const dir of pluginDirs) {
            const pluginName = dir.name;
            const pluginPath = path.join(this.pluginFolder, pluginName, 'plugin.js');

            if (!fs.existsSync(pluginPath)) {
                AppContext.error(`⚠️ No plugin.js found in: ${pluginName}`);
                continue;
            }

            try {
                const plugin = require(pluginPath);
                if (plugin && typeof plugin.register === 'function') {
                    if (typeof plugin.priority !== 'number') {
                        AppContext.log(`ℹ️ Plugin '${pluginName}' has no priority — defaulting to 100`);
                        plugin.priority = 100;
                    }
                    AppContext.plugins[pluginName] = plugin;
                } else {
                    AppContext.error(`❌ Invalid plugin (no register): ${pluginName}`);
                }
            } catch (err) {
                AppContext.error(`❌ Failed to load plugin "${pluginName}": ${err.message}`);
            }
        }
        // ✅ Now register plugins in priority order
        Object.entries(AppContext.plugins)
        .map(([name, plugin]) => ({
            name,
            plugin,
            priority: plugin.priority ?? 100
        }))
        .sort((a, b) => a.priority - b.priority)
        .forEach(({ name, plugin }) => {
            try {
                plugin.register(AppContext);
                AppContext.log(`✅ Plugin registered: ${name} (priority: ${plugin.priority})`);
            } catch (err) {
                AppContext.error(`❌ Error registering plugin '${name}': ${err.message}`);
            }
        });

    }

}



module.exports = { pluginDirector };
