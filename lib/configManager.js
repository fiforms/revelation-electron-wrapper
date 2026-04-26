const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const crypto = require('crypto');
const { defaultInstanceName } = require('./mdnsManager');
const { generateKeyPair } = require('./peerAuth');
const { copyAgentDocsToPresDir } = require('./docsPresentationBuilder');
const userResources = path.join(app.getPath('userData'), 'resources');
const defaultRevelationDir = !app.isPackaged ? path.join(__dirname, '..', 'revelation')
  : fs.existsSync(path.join(userResources, 'revelation'))
  ? path.join(userResources, 'revelation')
: path.join(process.resourcesPath, 'revelation');
// Plugins enabled on first run. New plugins installed later must be enabled manually.
const defaultPlugins = ["addmedia","bibletext","hymnary","virtualbiblesnapshots", "resources", "mediafx", "compactor", "richbuilder", "slidesorter", "mdvalidate"];

const defaultConfig = {
  mode: 'localhost',
  preferredDisplay: 0,
  zoomFactor: 1,
  logFile: path.join(app.getPath('userData'), 'debug.log'),
  presentationsDir: null,
  key: [...Array(10)].map(() => Math.random().toString(36)[2]).join(''),
  viteServerPort: 8000,
  apiServerPort: 8001,
  apiServerEnabled: true,
  revealRemotePublicServer: "https://revealremote.fiforms.org/",
  presenterPluginsPublicServer: "https://revealremote.fiforms.org/presenter-plugins-socket",
  preferHighBitrate: false,
  autoConvertAv1Media: false,
  ffmpegPath: null,
  ffprobePath: null,
  plugins: defaultPlugins,
  pluginConfigs: {},
  language: 'en',
  preferredPresentationLanguage: '',
  ccliLicenseNumber: '',
  screenTypeVariant: '',
  mdnsBrowse: true,
  mdnsPublish: false,
  mdnsInstanceName: defaultInstanceName(),
  mdnsInstanceId: crypto.randomBytes(8).toString('hex'),
  mdnsAuthToken: crypto.randomBytes(32).toString('hex'),
  mdnsPairingPin: null,
  rsaPublicKey: null,
  rsaPrivateKey: null,
  pairedMasters: [],
  revelationDir: defaultRevelationDir,
  updateCheckEnabled: true,
  updateCheckLastCheckedAt: null,
  updateCheckIgnoredVersion: null,
  pipEnabled: false,
  pipSide: 'left',
  pipColor: '#00ff00',
  globalHotkeys: {
    pipToggle: '',
    previous: '',
    next: '',
    blank: '',
    up: '',
    down: '',
    left: '',
    right: ''
  },
  additionalScreens: [],
  presentationPublishKey: crypto.randomBytes(8).toString('hex'),
  presentationScreenMode: 'group-control',
  virtualPeersAlwaysOpen: false,
  virtualPeersDefaultMode: 'black',
  virtualPeersDefaultPresentation: '',
  mainWindowMode: 'fullscreen',
  mainWindowOpenOnPeerPush: true,
  mainWindowMuted: false,
  firstRunCompleted: false
};

const configPath = path.join(app.getPath('userData'), 'config.json');
const profilesDir = path.join(app.getPath('userData'), 'profiles');

function getProfileConfigPath(profileName) {
  return path.join(profilesDir, `${profileName}.config.json`);
}

function listProfiles() {
  const profiles = ['Default'];
  if (fs.existsSync(profilesDir)) {
    try {
      const files = fs.readdirSync(profilesDir);
      for (const file of files) {
        if (file.endsWith('.config.json')) {
          const name = file.slice(0, -'.config.json'.length);
          if (name && name !== 'Default') {
            profiles.push(name);
          }
        }
      }
    } catch (err) {
      console.error(`Error reading profiles directory: ${err.message}`);
    }
  }
  return profiles;
}

function validateProfileName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed === 'Default') return false;
  if (trimmed.length > 50) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/.test(trimmed);
}

function saveConfigAsProfile(name, config) {
  if (!validateProfileName(name)) throw new Error(`Invalid profile name: "${name}"`);
  fs.mkdirSync(profilesDir, { recursive: true });
  const profilePath = getProfileConfigPath(name.trim());
  const toSave = _buildSaveableObject(config);
  toSave.profile = name.trim();
  fs.writeFileSync(profilePath, JSON.stringify(toSave, null, 2));
}

function setActiveProfile(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  let mainConfig = {};
  if (fs.existsSync(configPath)) {
    try { mainConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
  }
  if (trimmed && trimmed !== 'Default') {
    mainConfig.profile = trimmed;
  } else {
    delete mainConfig.profile;
  }
  fs.writeFileSync(configPath, JSON.stringify(mainConfig, null, 2));
}

function loadConfig() {
  // Peek at main config to discover active profile
  let mainConfigRaw = {};
  if (fs.existsSync(configPath)) {
    try { mainConfigRaw = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
  }
  const profileName = typeof mainConfigRaw.profile === 'string' && mainConfigRaw.profile.trim() && mainConfigRaw.profile.trim() !== 'Default'
    ? mainConfigRaw.profile.trim()
    : '';

  let targetConfigPath = configPath;
  if (profileName) {
    const profilePath = getProfileConfigPath(profileName);
    if (fs.existsSync(profilePath)) {
      targetConfigPath = profilePath;
    } else {
      console.warn(`Profile "${profileName}" not found at ${profilePath}, clearing profile and falling back to default`);
      delete mainConfigRaw.profile;
      try { fs.writeFileSync(configPath, JSON.stringify(mainConfigRaw, null, 2)); } catch {}
      // fall through to use main configPath
    }
  }

  if (fs.existsSync(targetConfigPath)) {
    try {
      console.log(`Loading config from ${targetConfigPath}${profileName ? ` (profile: ${profileName})` : ''}`);
      const loadedConfig = JSON.parse(fs.readFileSync(targetConfigPath, 'utf-8'));
      // Set profile on loaded config before normalization so saveConfig writes to the right place
      if (profileName) {
        loadedConfig.profile = profileName;
      } else {
        delete loadedConfig.profile;
      }
      if (!loadedConfig.pluginConfigs || typeof loadedConfig.pluginConfigs !== 'object' || Array.isArray(loadedConfig.pluginConfigs)) {
        loadedConfig.pluginConfigs = {};
        saveConfig(loadedConfig);
      }
      loadedConfig.presentationsDir = findPresentationsDir(loadedConfig.presentationsDir, loadedConfig.profile);
      if (typeof loadedConfig.mdnsBrowse !== 'boolean') {
        if (typeof loadedConfig.mdnsEnabled === 'boolean') {
          loadedConfig.mdnsBrowse = loadedConfig.mdnsEnabled;
        } else {
          loadedConfig.mdnsBrowse = true;
        }
        saveConfig(loadedConfig);
        console.warn(`Updated config with mdnsBrowse: ${loadedConfig.mdnsBrowse}`);
      }
      if (typeof loadedConfig.mdnsPublish !== 'boolean') {
        if (typeof loadedConfig.mdnsEnabled === 'boolean') {
          loadedConfig.mdnsPublish = loadedConfig.mdnsEnabled;
        } else {
          loadedConfig.mdnsPublish = false;
        }
        saveConfig(loadedConfig);
        console.warn(`Updated config with mdnsPublish: ${loadedConfig.mdnsPublish}`);
      }
      if (Object.prototype.hasOwnProperty.call(loadedConfig, 'mdnsEnabled')) {
        delete loadedConfig.mdnsEnabled;
        saveConfig(loadedConfig);
        console.warn('Removed legacy mdnsEnabled config key');
      }
      if (!loadedConfig.key || typeof loadedConfig.key !== 'string') {
        loadedConfig.key = [...Array(10)].map(() => Math.random().toString(36)[2]).join('');
        saveConfig(loadedConfig);
        console.warn('Generated server access key');
      }
      if (!loadedConfig.mdnsInstanceName) {
        loadedConfig.mdnsInstanceName = defaultInstanceName();
        saveConfig(loadedConfig);
        console.warn(`Updated config with mdnsInstanceName: ${loadedConfig.mdnsInstanceName}`);
      }
      if (!loadedConfig.mdnsInstanceId) {
        loadedConfig.mdnsInstanceId = crypto.randomBytes(8).toString('hex');
        saveConfig(loadedConfig);
        console.warn('Generated mdnsInstanceId');
      }
      if (!loadedConfig.mdnsAuthToken) {
        loadedConfig.mdnsAuthToken = crypto.randomBytes(32).toString('hex');
        saveConfig(loadedConfig);
        console.warn('Generated mdnsAuthToken');
      }
      if (loadedConfig.mdnsPublish && !loadedConfig.mdnsPairingPin) {
        const length = 6;
        const min = 10 ** (length - 1);
        const max = 10 ** length - 1;
        loadedConfig.mdnsPairingPin = String(Math.floor(Math.random() * (max - min + 1)) + min);
        saveConfig(loadedConfig);
        console.warn(`Generated mdnsPairingPin: ${loadedConfig.mdnsPairingPin}`);
      }
      if (!loadedConfig.rsaPublicKey || !loadedConfig.rsaPrivateKey) {
        const { publicKey, privateKey } = generateKeyPair();
        loadedConfig.rsaPublicKey = publicKey;
        loadedConfig.rsaPrivateKey = privateKey;
        saveConfig(loadedConfig);
        console.warn('Generated RSA keypair for peer authentication');
      }
      if (!Array.isArray(loadedConfig.pairedMasters)) {
        loadedConfig.pairedMasters = [];
        saveConfig(loadedConfig);
      }
      loadedConfig.additionalScreens = normalizeAdditionalScreens(loadedConfig.additionalScreens);
      if (!loadedConfig.presentationPublishKey || typeof loadedConfig.presentationPublishKey !== 'string') {
        loadedConfig.presentationPublishKey = crypto.randomBytes(8).toString('hex');
        saveConfig(loadedConfig);
      }
      if (typeof loadedConfig.presentationScreenMode !== 'string' || !['always-open', 'group-control', 'on-demand'].includes(loadedConfig.presentationScreenMode)) {
        if (typeof loadedConfig.virtualPeersAlwaysOpen === 'boolean') {
          loadedConfig.presentationScreenMode = loadedConfig.virtualPeersAlwaysOpen ? 'group-control' : 'on-demand';
        } else {
          loadedConfig.presentationScreenMode = defaultConfig.presentationScreenMode;
        }
        saveConfig(loadedConfig);
      }
      if (typeof loadedConfig.firstRunCompleted !== 'boolean') {
        loadedConfig.firstRunCompleted = true;
        saveConfig(loadedConfig);
      }

      return Object.assign({}, defaultConfig, loadedConfig);
    } catch {
      console.error(`Error reading config file at ${targetConfigPath}, using default config`);
      defaultConfig.presentationsDir = findPresentationsDir();
      return defaultConfig;
    }
  }
  const config = Object.assign({}, defaultConfig);
  config.presentationsDir = findPresentationsDir();
  if (!config.rsaPublicKey || !config.rsaPrivateKey) {
    const { publicKey, privateKey } = generateKeyPair();
    config.rsaPublicKey = publicKey;
    config.rsaPrivateKey = privateKey;
  }
  // Do not persist the key.
  saveConfig(config);
  console.warn(`Config file not found, created default at ${configPath}`);
  return config;
}

// Build the plain object that should be persisted (strips runtime-only keys, normalizes arrays).
function _buildSaveableObject(config) {
  const out = { ...config };
  delete out.mdnsEnabled;
  delete out.runtimeEnableDevTools;
  delete out.virtualPeersAlwaysOpen;
  if (out.revelationDir === defaultRevelationDir) {
    delete out.revelationDir;
  }
  if (Array.isArray(out.pairedMasters)) {
    out.pairedMasters = out.pairedMasters
      .filter((item) => item && item.instanceId)
      .map((item) => ({
        instanceId: item.instanceId,
        name: item.name,
        publicKey: item.publicKey,
        pairedAt: item.pairedAt,
        hostHint: item.hostHint,
        pairingPortHint: item.pairingPortHint,
        pairingPin: item.pairingPin,
        natCompatibility: item.natCompatibility === true
      }));
  }
  out.additionalScreens = normalizeAdditionalScreens(out.additionalScreens);
  return out;
}

function saveConfig(config) {
  const profileName = typeof config.profile === 'string' && config.profile.trim() && config.profile.trim() !== 'Default'
    ? config.profile.trim()
    : '';

  const toSave = _buildSaveableObject(config);

  if (profileName) {
    // Write settings to the profile file
    fs.mkdirSync(profilesDir, { recursive: true });
    const profilePath = getProfileConfigPath(profileName);
    fs.writeFileSync(profilePath, JSON.stringify(toSave, null, 2));

    // Update only the profile pointer in the main config (preserves Default settings)
    let mainConfig = {};
    if (fs.existsSync(configPath)) {
      try { mainConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
    }
    mainConfig.profile = profileName;
    fs.writeFileSync(configPath, JSON.stringify(mainConfig, null, 2));
  } else {
    // No active profile — write everything to main config
    delete toSave.profile;
    fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2));
  }
}

function normalizeAdditionalScreens(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const target = item.target === 'display' ? 'display' : (item.target === 'publish' ? 'publish' : 'window');
      const parsedIndex = Number.parseInt(item.displayIndex, 10);
      const displayIndex = Number.isFinite(parsedIndex) && parsedIndex >= 0 ? parsedIndex : null;
      const language = typeof item.language === 'string' ? item.language.trim().toLowerCase() : '';
      const variant = typeof item.variant === 'string' ? item.variant.trim().toLowerCase() : '';
      const rawDefaultMode = typeof item.defaultMode === 'string' ? item.defaultMode.trim().toLowerCase() : '';
      const defaultMode = ['black', 'green', 'presentation'].includes(rawDefaultMode) ? rawDefaultMode : '';
      const defaultPresentation = typeof item.defaultPresentation === 'string' ? item.defaultPresentation.trim() : '';
      const muted = item.muted === true;
      if (target === 'display' && displayIndex === null) return null;
      return { target, displayIndex, language, variant, defaultMode, defaultPresentation, muted };
    })
    .filter(Boolean);
}

function findPresentationsDir(customDir = false, profileName = '') {
    const activeProfile = typeof profileName === 'string' && profileName.trim() && profileName.trim() !== 'Default'
      ? profileName.trim()
      : '';

    let presDir = customDir;
    if (presDir && !fs.existsSync(presDir)) {
      console.error(`Presentations directory ${presDir} does not exist. Using Default.`);
      presDir = false;
    }
    if(!presDir) {
      const baseDir = app.getPath('documents');
      const folderName = activeProfile ? `REVELation Presentations (${activeProfile})` : 'REVELation Presentations';
      presDir = path.join(baseDir, folderName);
      if (fs.existsSync(presDir)) {
        console.log(`Found presentations directory at: ${presDir}`);
      }
      else {
        console.log(`No presentations directory configured, creating one at ${presDir}`);
        fs.mkdirSync(presDir, { recursive: true });
        copyAgentDocsToPresDir(presDir, defaultRevelationDir);
      }
    }
    if (!fs.existsSync(path.join(presDir,'_media'))) {
      fs.mkdirSync(path.join(presDir,'_media'), { recursive: true });
      console.log(`📁 Created _media folder inside ${presDir}`);
    }
    return path.join(presDir);
}

module.exports = { loadConfig, saveConfig, saveConfigAsProfile, setActiveProfile, listProfiles, validateProfileName, configPath, profilesDir };
