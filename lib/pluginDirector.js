// Plugin discovery, loading, ZIP installation and the plugin-related IPC surface.
// - populatePlugins(): require()s plugins/<name>/plugin.js for each name in config.plugins, sets
//   plugin.version from plugin-manifest.json, and calls register(AppContext) in priority order.
// - writePluginsIndex(): writes plugins.json (plugins with exposeToBrowser + clientHookJS) for the
//   browser-side loader. Config values go through pluginConfigView.browserSafeConfig, so fields marked
//   `secret: true` (and keys in a plugin's `privateConfigKeys`) are never published. get-plugin-list
//   applies the same filter unless the caller passes { includeSecrets: true } (only Settings does).
// - Install: menu:install-plugin-zip (user-picked ZIP, trust warning, manifest + min version
//   check, staged extract) and installPluginFromUrl (HTTPS download, optional sha256 pin, enables
//   the plugin; called from lib/popplerInstaller.js, the first-run setup for popplerpdf).
// IPC: plugin-trigger (plugin.api[invoke]), presentation-plugin-trigger (plugin.presentationApi),
// get-all-plugin-manifests, get-plugin-export-formats, get-plugin-list.
// Plugin folder: plugins/ in dev, userData/resources/plugins or resourcesPath/plugins when packaged.
// Security: plugins run with full user privileges, so installation is gated by a warning dialog;
// keep the manifest/version validation in readPluginZip and the path check in extractZipSafely.
// Docs: doc/dev/PLUGINS.md. Note: has its own compareVersions (also in revelFormat.js, updateChecker.js).
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { app, dialog, net } = require('electron');
const unzipper = require('unzipper');
const { pipeline } = require('stream/promises');
const { execFile } = require('child_process');
const { buildServerURL } = require('./serverUrl');
const { resolveInside } = require('./pathSafety');
const { saveConfig } = require('./configManager');
const { browserSafeConfig } = require('./pluginConfigView');
const userDataDir = app.getPath('userData');
const userResources = path.join(userDataDir, 'resources');

const defaultPluginDir = !app.isPackaged ? path.join(__dirname, '..', 'plugins')
  : fs.existsSync(path.join(userResources, 'plugins'))
  ? path.join(userResources, 'plugins')
: path.join(process.resourcesPath, 'plugins');

// Manifest strings shown in Settings (title, description, collaboration_detail)
// are authored per plugin, so they are translated from the plugin's own
// locales/translations.json rather than the app-wide file — same convention and
// same `{ locale: { english: translated } }` shape the plugin's client UI uses.
// The English text in the manifest is the lookup key, as everywhere else in the
// project. Missing file, locale or key simply yields the English original.
const _pluginLocaleCache = new Map();

function loadPluginLocale(pluginFolder, pluginName, language) {
  const lang = String(language || '').trim();
  if (!lang || lang === 'en') return null;
  const localePath = path.join(pluginFolder, pluginName, 'locales', 'translations.json');
  const cacheKey = `${localePath}::${lang}`;
  if (_pluginLocaleCache.has(cacheKey)) return _pluginLocaleCache.get(cacheKey);

  let table = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(localePath, 'utf-8'));
    const candidate = parsed?.[lang];
    if (candidate && typeof candidate === 'object') table = candidate;
  } catch (_err) {
    table = null; // no locales file, or malformed — fall back to English
  }
  _pluginLocaleCache.set(cacheKey, table);
  return table;
}

function translateManifestString(table, text) {
  if (!table || typeof text !== 'string' || !text) return text;
  const translated = table[text];
  return typeof translated === 'string' && translated ? translated : text;
}

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
        let outPath;
        try {
            outPath = resolveInside(destPath, relPath);
        } catch {
            throw new Error(`Unsafe ZIP entry path: ${entry.path}`);
        }
        await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
        await pipeline(entry.stream(), fs.createWriteStream(outPath));
        // Keep the executable bit from ZIPs made on macOS/Linux (e.g. the
        // popplerpdf macOS binaries); no other mode bits are carried over.
        const unixMode = (entry.externalFileAttributes >>> 16) & 0o777;
        if (process.platform !== 'win32' && (unixMode & 0o111)) {
            await fs.promises.chmod(outPath, 0o755);
        }
    }
}

// Open a plugin ZIP and validate its manifest. Throws with a user-facing
// message when the ZIP is not an installable plugin for this app version.
async function readPluginZip(zipPath) {
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
    if (compareVersions(minRevelationVersion, currentAppVersion) > 0) {
        throw new Error(
            `Plugin requires REVELation application >= ${minRevelationVersion}, but you are running ${currentAppVersion}.`
        );
    }

    return { directory, manifest, pluginId, pluginVersion };
}

// Extract into a staging folder first, then swap it in, so a failed extract
// never leaves the previously installed copy half-deleted.
async function extractPluginZip(directory, destPath) {
    const stagingPath = `${destPath}${STAGING_SUFFIX}`;
    fs.rmSync(stagingPath, { recursive: true, force: true });
    await fs.promises.mkdir(stagingPath, { recursive: true });
    try {
        await extractZipSafely(directory, stagingPath);
    } catch (err) {
        fs.rmSync(stagingPath, { recursive: true, force: true });
        throw err;
    }
    fs.rmSync(destPath, { recursive: true, force: true });
    await fs.promises.rename(stagingPath, destPath);
    clearPluginRequireCache(destPath);
}

// Staging folder name used by extractPluginZip; never a plugin.
const STAGING_SUFFIX = '.installing';

// require() caches plugin.js and everything it loads, so a reinstalled plugin would keep running its old
// code until restart. Drop every cached module that lives inside the plugin's folder.
function clearPluginRequireCache(pluginDir) {
    // require.cache is keyed by real path, so also match the symlink-resolved folder (macOS /var -> /private/var).
    const prefixes = [path.resolve(pluginDir)];
    try { prefixes.push(fs.realpathSync(pluginDir)); } catch { /* folder gone: nothing cached under a real path */ }
    for (const file of Object.keys(require.cache)) {
        if (prefixes.some(p => file.startsWith(p + path.sep))) delete require.cache[file];
    }
}

const MAX_PLUGIN_DOWNLOAD_BYTES = 300 * 1024 * 1024;

async function downloadToFile(url, destFile, onProgress) {
    const response = await net.fetch(url, { cache: 'no-store' });
    if (!response.ok || !response.body) {
        throw new Error(`Download failed (HTTP ${response.status}).`);
    }
    const total = Number(response.headers.get('content-length')) || 0;
    if (total > MAX_PLUGIN_DOWNLOAD_BYTES) {
        throw new Error('Download is larger than expected.');
    }
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(destFile);
    let received = 0;
    try {
        const reader = response.body.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.length;
            if (received > MAX_PLUGIN_DOWNLOAD_BYTES) {
                await reader.cancel();
                throw new Error('Download is larger than expected.');
            }
            hash.update(value);
            if (!out.write(value)) {
                await new Promise((resolve) => out.once('drain', resolve));
            }
            if (typeof onProgress === 'function') onProgress({ received, total });
        }
    } finally {
        await new Promise((resolve) => out.end(resolve));
    }
    return { sha256: hash.digest('hex'), bytes: received };
}

const pluginDirector = {

    pluginFolder: null,

    resolvePluginFolder(AppContext) {
        if (!app.isPackaged) {
            this.pluginFolder = defaultPluginDir;
            AppContext.config.pluginFolder = defaultPluginDir;
            return this.pluginFolder;
        }

        const configuredFolder = AppContext.config.pluginFolder;
        if (configuredFolder && fs.existsSync(configuredFolder) && fs.statSync(configuredFolder).isDirectory()) {
            this.pluginFolder = configuredFolder;
            return this.pluginFolder;
        }

        if (configuredFolder && configuredFolder !== defaultPluginDir) {
            AppContext.error(`⚠️ Configured plugin folder missing, falling back to default plugin folder: ${configuredFolder}`);
        }

        this.pluginFolder = defaultPluginDir;
        AppContext.config.pluginFolder = defaultPluginDir;
        return this.pluginFolder;
    },

    register(ipcMain, AppContext) {
        if(!AppContext.config.pluginFolder) {
            AppContext.config.pluginFolder = defaultPluginDir;
        }

        this.resolvePluginFolder(AppContext);

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

        ipcMain.handle('presentation-plugin-trigger', async (_event, pluginName, invoke, data) => {
            if(!AppContext.plugins[pluginName]) {
                AppContext.error(`⚠️ Failed to invoke presentation ${invoke} on plugin "${pluginName}": Plugin Not Found`)
                return 1;
            }
            if(!AppContext.plugins[pluginName].presentationApi || !AppContext.plugins[pluginName].presentationApi[invoke]) {
                AppContext.error(`⚠️ Failed to invoke presentation ${invoke} on plugin "${pluginName}": Plugin Not Found`)
                return 1;
            }
            try {
                return await AppContext.plugins[pluginName].presentationApi[invoke](_event,data);
            } catch (err) {
                AppContext.error(`❌ Failed to invoke presentation ${invoke} on plugin "${pluginName}": ${err.message}`)
            }
        });

        ipcMain.handle('get-all-plugin-manifests', () => {
            const pluginFolder = this.pluginFolder || AppContext.config.pluginFolder;
            const allFolders = Array.isArray(AppContext.allPluginFolders) ? AppContext.allPluginFolders : [];
            const manifests = {};
            const language = AppContext.config?.language || 'en';
            for (const name of allFolders) {
                const manifestPath = path.join(pluginFolder, name, 'plugin-manifest.json');
                const locale = loadPluginLocale(pluginFolder, name, language);
                const tr = (text) => translateManifestString(locale, text);
                try {
                    const raw = fs.readFileSync(manifestPath, 'utf-8');
                    const parsed = JSON.parse(raw);
                    manifests[name] = {
                        title: tr(typeof parsed.title === 'string' ? parsed.title : name),
                        description: tr(typeof parsed.description === 'string' ? parsed.description : ''),
                        // `collaboration: true` marks a plugin that lets viewers act on
                        // the shared slide space rather than only watch it. Surfaced in
                        // Settings so enabling one is an informed choice — see
                        // the collaboration carve-out in revelation/doc/SECURITY.md.
                        collaboration: parsed.collaboration === true,
                        collaboration_detail: tr(
                            typeof parsed.collaboration_detail === 'string'
                                ? parsed.collaboration_detail
                                : ''
                        ),
                        author: typeof parsed.author === 'string' ? parsed.author : '',
                        webpage: typeof parsed.webpage === 'string' ? parsed.webpage : '',
                        plugin_version: typeof parsed.plugin_version === 'string' ? parsed.plugin_version : ''
                    };
                } catch (_err) {
                    manifests[name] = {
                        title: name,
                        description: '',
                        collaboration: false,
                        collaboration_detail: '',
                        author: '',
                        webpage: '',
                        plugin_version: ''
                    };
                }
            }
            return manifests;
        });

        ipcMain.handle('get-plugin-export-formats', () => {
            const formats = [];
            for (const [pluginName, plugin] of Object.entries(AppContext.plugins)) {
                if (Array.isArray(plugin.exportFormats)) {
                    for (const fmt of plugin.exportFormats) {
                        formats.push({ pluginName, ...fmt });
                    }
                }
            }
            return formats;
        });

        ipcMain.handle('get-plugin-list', function (_event, options = false) {
            let withTemplate = false;
            let includeSecrets = false;
            let hostOverride = null;
            if (typeof options === 'boolean') {
                withTemplate = options;
            } else if (options && typeof options === 'object') {
                withTemplate = !!options.withTemplate;
                includeSecrets = options.includeSecrets === true;
                if (typeof options.host === 'string' && options.host.trim().length) {
                    hostOverride = options.host.trim();
                }
            }
            const hostWithPort = hostOverride
                ? (hostOverride.includes(':') ? hostOverride : `${hostOverride}:${AppContext.config.viteServerPort}`)
                : `${AppContext.hostURL}:${AppContext.config.viteServerPort}`;
            const pluginList = {};
            const protocol = AppContext.config.httpsEnabled ? 'https' : 'http';

            for (const [name, plugin] of Object.entries(AppContext.plugins)) {
                pluginList[name] = {
                    baseURL: `${protocol}://${hostWithPort}/plugins_${AppContext.config.key}/${name}`,
                    priority: plugin.priority,
                    version: plugin.version || '0.0.0',
                    // Credentials are left out unless the caller (Settings) asks for them.
                    config: includeSecrets ? plugin.config : browserSafeConfig(plugin),
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
                const { directory, manifest, pluginId, pluginVersion } = await readPluginZip(zipPath);

                const destPath = path.join(pluginFolder, pluginId);

                // If plugin folder exists, ask before overwriting
                if (fs.existsSync(destPath)) {
                    let currentManifest = {};
                    try {
                        const raw = fs.readFileSync(path.join(destPath, 'plugin-manifest.json'), 'utf-8');
                        currentManifest = JSON.parse(raw);
                    } catch (_err) { /* ignore — installed copy may be corrupt */ }

                    const currentTitle   = currentManifest.title   || pluginId;
                    const currentVersion = currentManifest.plugin_version || '(unknown)';
                    const currentAuthor  = currentManifest.author  || '';

                    const incomingTitle  = manifest.title  || pluginId;
                    const incomingAuthor = manifest.author || '';

                    const lines = [
                        `Installed:  ${currentTitle}  v${currentVersion}${currentAuthor ? `  (${currentAuthor})` : ''}`,
                        `Incoming:   ${incomingTitle}  v${pluginVersion}${incomingAuthor ? `  (${incomingAuthor})` : ''}`,
                    ];

                    if (compareVersions(pluginVersion, currentVersion) < 0) {
                        lines.push('\nWarning: the incoming version is older than the installed version.');
                    }

                    const { response } = await dialog.showMessageBox({
                        type: 'question',
                        title: 'Plugin Already Installed',
                        message: `"${currentTitle}" is already installed. Overwrite it?`,
                        detail: lines.join('\n'),
                        buttons: ['Overwrite', 'Cancel'],
                        defaultId: 1,
                        cancelId: 1,
                    });
                    if (response !== 0) return;
                }

                await extractPluginZip(directory, destPath);

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

    // Download a plugin ZIP from a fixed, app-supplied URL, install it (replacing
    // any existing copy), enable it and reload the plugin list. Used by the
    // first-run setup so Windows users get PDF import without a manual
    // download → install → enable → restart round trip. The caller must pass
    // expectedId so a ZIP with a different plugin inside is refused, and may
    // pass expectedSha256 to pin the exact release asset.
    async installPluginFromUrl(AppContext, url, { expectedId, expectedSha256 = '', onProgress } = {}) {
        if (!PLUGIN_ID_RE.test(String(expectedId || ''))) {
            throw new Error('installPluginFromUrl requires a valid expectedId.');
        }
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== 'https:') {
            throw new Error('Plugin downloads must use HTTPS.');
        }

        const tmpZip = path.join(os.tmpdir(), `revelation-plugin-${expectedId}-${crypto.randomBytes(6).toString('hex')}.zip`);
        try {
            AppContext.log(`📥 Downloading plugin "${expectedId}" from ${url}`);
            const { sha256 } = await downloadToFile(url, tmpZip, onProgress);
            if (expectedSha256 && sha256 !== String(expectedSha256).toLowerCase()) {
                throw new Error('Downloaded file failed its integrity check.');
            }

            const { directory, pluginId, pluginVersion } = await readPluginZip(tmpZip);
            if (pluginId !== expectedId) {
                throw new Error(`Downloaded ZIP contains plugin "${pluginId}", expected "${expectedId}".`);
            }

            const pluginFolder = this.resolvePluginFolder(AppContext);
            const destPath = path.join(pluginFolder, pluginId);
            await extractPluginZip(directory, destPath);
            if (process.platform === 'darwin') {
                // Files we write ourselves should not be quarantined, but if they
                // are, Gatekeeper would block the bundled binaries. Errors (such
                // as "no such xattr") are expected and ignored.
                await new Promise((resolve) => {
                    execFile('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', destPath], () => resolve());
                });
            }

            if (!Array.isArray(AppContext.config.plugins)) AppContext.config.plugins = [];
            if (!AppContext.config.plugins.includes(pluginId)) {
                AppContext.config.plugins.push(pluginId);
            }
            this.populatePlugins(AppContext);
            this.writePluginsIndex(AppContext);
            saveConfig(AppContext.config);

            AppContext.log(`✅ Plugin "${pluginId}" v${pluginVersion} downloaded, installed and enabled.`);
            return { pluginId, pluginVersion };
        } finally {
            fs.rmSync(tmpZip, { force: true });
        }
    },

    // The object written to plugins.json. Served to browsers, so each config goes through
    // browserSafeConfig (no credentials; see lib/pluginConfigView.js).
    buildPluginsIndex(AppContext) {
        const pluginList = {};
        for (const [name, plugin] of Object.entries(AppContext.plugins)) {
            if (plugin.exposeToBrowser && typeof plugin.clientHookJS === 'string') {
                pluginList[name] = {
                    baseURL: `/plugins_${AppContext.config.key}/${name}`,
                    priority: plugin.priority,
                    config: browserSafeConfig(plugin),
                    clientHookJS: plugin.clientHookJS
                };
            }
        }
        return pluginList;
    },

    writePluginsIndex(AppContext) {
        const pluginFolder = this.resolvePluginFolder(AppContext);
        const indexPath = path.join(pluginFolder, 'plugins.json');
        const pluginList = this.buildPluginsIndex(AppContext);
        try {
          fs.mkdirSync(pluginFolder, { recursive: true });
          fs.writeFileSync(indexPath, JSON.stringify(pluginList, null, 2), 'utf-8');
        }
        catch(err) {
            AppContext.error(`❌ Failed to write plugins index: ${err.message}`);
        }
        AppContext.log(`📝 Updated plugins index at ${indexPath}`);
    },

    populatePlugins(AppContext) {
        const pluginFolder = this.resolvePluginFolder(AppContext);

        AppContext.plugins = {};  // Force reset all loaded plugins, for reloading

        const configuredPlugins = Array.isArray(AppContext.config.plugins) 
            ? AppContext.config.plugins 
            : [];

        const pluginDirs = configuredPlugins.filter(name => {
            const dirPath = path.join(pluginFolder, name);
            return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
        });

        const allAvailablePluginDirs = fs.existsSync(pluginFolder)
            ? fs.readdirSync(pluginFolder, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory() && !dirent.name.endsWith(STAGING_SUFFIX))
                .map(dirent => dirent.name)
            : [];

        // To use `allAvailablePluginDirs` later in the settings panel
        AppContext.allPluginFolders = allAvailablePluginDirs;

        for (const pluginName of pluginDirs) {
            const pluginPath = path.join(pluginFolder, pluginName, 'plugin.js');

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
                    // plugin-manifest.json is the single source of truth for the version.
                    try {
                        const manifest = JSON.parse(fs.readFileSync(path.join(pluginFolder, pluginName, 'plugin-manifest.json'), 'utf-8'));
                        plugin.version = typeof manifest.plugin_version === 'string' ? manifest.plugin_version : '';
                    } catch (err) {
                        AppContext.error(`⚠️ Could not read plugin-manifest.json for "${pluginName}": ${err.message}`);
                        plugin.version = '';
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
                if (AppContext.config.pluginConfigs?.[name]) {
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



module.exports = { pluginDirector, clearPluginRequireCache };
