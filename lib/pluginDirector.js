
const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');
const unzipper = require('unzipper');
const { pipeline } = require('stream/promises');
const userDataDir = app.getPath('userData');
const userResources = path.join(userDataDir, 'resources');

const defaultPluginDir = !app.isPackaged ? path.join(__dirname, '..', 'plugins') 
  : fs.existsSync(path.join(userResources, 'plugins'))
  ? path.join(userResources, 'plugins')
: path.join(process.resourcesPath, 'plugins');

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
const SIMPLE_VERSION_RE = /^\d+(?:\.\d+){0,2}(?:[-._]?[0-9A-Za-z]+)?$/;

function normalizeZipPath(entryPath) {
    return String(entryPath || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function parseVersion(version) {
    const raw = String(version || '').trim();
    if (!raw) throw new Error('Version is required');
    if (!SIMPLE_VERSION_RE.test(raw)) {
        throw new Error(`Invalid version format: ${raw}`);
    }
    const match = raw.match(/^(\d+(?:\.\d+){0,2})(.*)$/);
    if (!match) {
        throw new Error(`Invalid version format: ${raw}`);
    }
    const numeric = match[1].split('.').map((part) => Number(part));
    while (numeric.length < 3) numeric.push(0);
    const suffix = (match[2] || '').trim();
    return { numeric, suffix };
}

function compareVersions(a, b) {
    const va = parseVersion(a);
    const vb = parseVersion(b);
    for (let i = 0; i < 3; i += 1) {
        if (va.numeric[i] !== vb.numeric[i]) {
            return va.numeric[i] - vb.numeric[i];
        }
    }
    if (va.suffix === vb.suffix) return 0;
    if (!va.suffix) return 1;
    if (!vb.suffix) return -1;
    return va.suffix.localeCompare(vb.suffix);
}

async function extractZipSafely(directory, destPath) {
    for (const entry of directory.files) {
        if (entry.type === 'Directory') continue;
        const relPath = normalizeZipPath(entry.path);
        if (!relPath || relPath.includes('\0')) {
            throw new Error(`Invalid ZIP entry path: ${entry.path}`);
        }
        const outPath = path.join(destPath, relPath);
        const normalizedDest = path.resolve(destPath) + path.sep;
        const normalizedOut = path.resolve(outPath);
        if (!normalizedOut.startsWith(normalizedDest)) {
            throw new Error(`Unsafe ZIP entry path: ${entry.path}`);
        }
        await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
        await pipeline(entry.stream(), fs.createWriteStream(outPath));
    }
}

const pluginDirector = {

    pluginFolder: null,

    register(ipcMain, AppContext) {
        if(!AppContext.config.pluginFolder) {
            AppContext.config.pluginFolder = defaultPluginDir;
        }

        this.pluginFolder = AppContext.config.pluginFolder;

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

        ipcMain.handle('get-plugin-list', function (_event, options = false) {
            let withTemplate = false;
            let hostOverride = null;
            if (typeof options === 'boolean') {
                withTemplate = options;
            } else if (options && typeof options === 'object') {
                withTemplate = !!options.withTemplate;
                if (typeof options.host === 'string' && options.host.trim().length) {
                    hostOverride = options.host.trim();
                }
            }
            const hostWithPort = hostOverride
                ? (hostOverride.includes(':') ? hostOverride : `${hostOverride}:${AppContext.config.viteServerPort}`)
                : `${AppContext.hostURL}:${AppContext.config.viteServerPort}`;
            const pluginList = {};

            for (const [name, plugin] of Object.entries(AppContext.plugins)) {
                pluginList[name] = {
                    baseURL: `http://${hostWithPort}/plugins_${AppContext.config.key}/${name}`,
                    priority: plugin.priority,
                    version: plugin.version || '0.0.0',
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

        AppContext.callbacks['menu:install-plugin-zip'] = async () => {
            const trustWarning = await dialog.showMessageBox({
                type: 'warning',
                title: AppContext.translate('Install Plugin from ZIP…'),
                message: AppContext.translate('Security warning: Plugins can access local files and execute code with your user permissions.'),
                detail: AppContext.translate('Only install plugin ZIP files from sources you fully trust. Continue with installation?'),
                buttons: [
                    AppContext.translate('Continue Install'),
                    AppContext.translate('Cancel')
                ],
                defaultId: 1,
                cancelId: 1
            });
            if (trustWarning.response !== 0) return;

            const { canceled, filePaths } = await dialog.showOpenDialog({
                title: 'Install Plugin ZIP',
                filters: [{ name: 'Plugin ZIP', extensions: ['zip'] }],
                properties: ['openFile']
            });

            if (canceled || !filePaths.length) return;

            const zipPath = filePaths[0];
            const pluginFolder = AppContext.config.pluginFolder;

            try {
                const directory = await unzipper.Open.file(zipPath);
                const manifestEntries = directory.files.filter((entry) =>
                    entry.type !== 'Directory' && normalizeZipPath(entry.path) === 'plugin-manifest.json'
                );
                if (manifestEntries.length !== 1) {
                    throw new Error('ZIP must contain exactly one plugin-manifest.json at the ZIP root.');
                }

                let manifest;
                try {
                    manifest = JSON.parse((await manifestEntries[0].buffer()).toString('utf8'));
                } catch (err) {
                    throw new Error(`Invalid plugin-manifest.json: ${err.message}`);
                }
                if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
                    throw new Error('plugin-manifest.json must contain a JSON object.');
                }

                const pluginId = String(manifest.id || '').trim();
                const pluginVersion = String(manifest.plugin_version || '').trim();
                const minRevelationVersion = String(manifest.min_revelation_version || '').trim();
                if (!PLUGIN_ID_RE.test(pluginId)) {
                    throw new Error('Manifest field "id" is required and must match /^[a-z0-9][a-z0-9_-]*$/.');
                }
                if (!pluginVersion || !SIMPLE_VERSION_RE.test(pluginVersion)) {
                    throw new Error('Manifest field "plugin_version" is required and must be a valid version string.');
                }
                if (!minRevelationVersion || !SIMPLE_VERSION_RE.test(minRevelationVersion)) {
                    throw new Error('Manifest field "min_revelation_version" is required and must be a valid version string.');
                }

                const hasPluginEntrypoint = directory.files.some((entry) =>
                    entry.type !== 'Directory' && normalizeZipPath(entry.path) === 'plugin.js'
                );
                if (!hasPluginEntrypoint) {
                    throw new Error('ZIP must contain plugin.js at the ZIP root.');
                }

                const currentAppVersion = app.getVersion();
                if (compareVersions(minRevelationVersion, currentAppVersion) < 0) {
                    throw new Error(
                        `Plugin requires min_revelation_version ${minRevelationVersion}, which is lower than this app version ${currentAppVersion}.`
                    );
                }

                const destPath = path.join(pluginFolder, pluginId);

                // If plugin folder exists, ask before overwriting
                if (fs.existsSync(destPath)) {
                    const { response } = await dialog.showMessageBox({
                        type: 'question',
                        title: 'Plugin Already Exists',
                        message: `Plugin "${pluginId}" already exists. Overwrite?`,
                        detail: `Incoming plugin version: ${pluginVersion}`,
                        buttons: ['Overwrite', 'Cancel'],
                    });
                    if (response !== 0) return;
                    fs.rmSync(destPath, { recursive: true, force: true });
                }

                await fs.promises.mkdir(destPath, { recursive: true });
                try {
                    await extractZipSafely(directory, destPath);
                } catch (err) {
                    fs.rmSync(destPath, { recursive: true, force: true });
                    throw err;
                }

                // Reload plugin system
                await AppContext.reloadServers();

                dialog.showMessageBox({
                    type: 'info',
                    message: `✅ Plugin "${pluginId}" installed successfully.`,
                    detail: `Version ${pluginVersion}`,
                });

            } catch (err) {
                AppContext.error(err);
                dialog.showMessageBox({
                type: 'error',
                message: `Failed to install plugin:\n${err.message}`,
                });
            }
        };


        this.populatePlugins(AppContext);
        this.writePluginsIndex(AppContext);
    },

    writePluginsIndex(AppContext) {
        const indexPath = path.join(this.pluginFolder, 'plugins.json');
        const pluginList = {};
        for (const [name, plugin] of Object.entries(AppContext.plugins)) {
            if (plugin.exposeToBrowser && typeof plugin.clientHookJS === 'string') {
                pluginList[name] = {
                    baseURL: `/plugins_${AppContext.config.key}/${name}`,
                    priority: plugin.priority,
                    config: plugin.config,
                    clientHookJS: plugin.clientHookJS
                };
            }
        }
        try {
          fs.writeFileSync(indexPath, JSON.stringify(pluginList, null, 2), 'utf-8');
        }
        catch(err) {
            AppContext.error(`❌ Failed to write plugins index: ${err.message}`);
        }
        AppContext.log(`📝 Updated plugins index at ${indexPath}`);
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
