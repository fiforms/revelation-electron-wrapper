
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

        ipcMain.handle('get-plugin-list', function (_event, withTemplate = false) {
            const pluginList = {};

            for (const [name, plugin] of Object.entries(AppContext.plugins)) {
                pluginList[name] = {
                    baseURL: `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/plugins_${AppContext.config.key}/${name}`,
                    priority: plugin.priority,
                    config: plugin.config,
                    pluginButtons: plugin.pluginButtons
                };
                if (withTemplate) {
                    pluginList[name].configTemplate = (plugin.configTemplate || []).map(field => {
                        const newField = { ...field };
                        if (typeof field.dropdownsrc === 'function') {
                            try {
                                newField.dropdownOptions = field.dropdownsrc(); // Call the function
                            } catch (err) {
                                console.warn(`⚠️ Failed to evaluate dropdownsrc for ${name}/${field.name}:`, err.message);
                                newField.dropdownOptions = [];
                            }
                            delete newField.dropdownsrc; // Don't send function over IPC
                        }
                        return newField;
                    });
                }
                if (typeof plugin.clientHookJS === 'string') {
                    pluginList[name].clientHookJS = plugin.clientHookJS;
                }
            }
            return pluginList;
        });

        this.populatePlugins(AppContext);
    },

    populatePlugins(AppContext) {

        AppContext.plugins = {};  // Force reset all loaded plugins, for reloading

        const configuredPlugins = Array.isArray(AppContext.config.plugins) 
            ? AppContext.config.plugins 
            : [];

        const pluginDirs = configuredPlugins.filter(name => {
            const dirPath = path.join(this.pluginFolder, name);
            return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
        });

        const allAvailablePluginDirs = fs.readdirSync(this.pluginFolder, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        // To use `allAvailablePluginDirs` later in the settings panel
        AppContext.allPluginFolders = allAvailablePluginDirs;

        console.log(pluginDirs);

        for (const pluginName of pluginDirs) {
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
                plugin.config = {};
                if (AppContext.config.pluginConfigs[name]) {
                    plugin.config = { ...AppContext.config.pluginConfigs[name] };
                } 
                else if (plugin.configTemplate && Array.isArray(plugin.configTemplate)) {
                    for (const item of plugin.configTemplate) {
                        if (item.name && item.hasOwnProperty('default')) {
                        plugin.config[item.name] = item.default;
                        }
                    }
                }
                plugin.register(AppContext);
                AppContext.log(`✅ Plugin registered: ${name} (priority: ${plugin.priority})`);
            } catch (err) {
                AppContext.error(`❌ Error registering plugin '${name}': ${err.message}`);
            }
        });

    }

}



module.exports = { pluginDirector };
