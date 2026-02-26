const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const crypto = require('crypto');
const { defaultInstanceName } = require('./mdnsManager');
const { generateKeyPair } = require('./peerAuth');

const userResources = path.join(app.getPath('userData'), 'resources');
const defaultRevelationDir = !app.isPackaged ? path.join(__dirname, '..', 'revelation') 
  : fs.existsSync(path.join(userResources, 'revelation'))
  ? path.join(userResources, 'revelation')
: path.join(process.resourcesPath, 'revelation');

const defaultConfig = {
  mode: 'localhost',
  preferredDisplay: 0,
  logFile: path.join(app.getPath('userData'), 'debug.log'),
  presentationsDir: null,
  key: [...Array(10)].map(() => Math.random().toString(36)[2]).join(''),
  viteServerPort: 8000,
  revealRemoteServerPort: 1947,
  revealRemotePublicServer: "https://revealremote.fiforms.org/",
  preferHighBitrate: false,
  autoConvertAv1Media: false,
  ffmpegPath: null,
  ffprobePath: null,
  plugins: ["addmedia","bibletext","hymnary","virtualbiblesnapshots", "resources", "mediafx"],
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
  firstRunCompleted: false
};

const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  if (fs.existsSync(configPath)) {
    try {
      console.log(`Loading config from ${configPath}`);
  const loadedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (!loadedConfig.pluginConfigs) {
        loadedConfig.pluginConfigs = {};
      }
      if (!loadedConfig.plugins) {
        loadedConfig.plugins = [];
      }
      loadedConfig.presentationsDir = findPresentationsDir(loadedConfig.presentationsDir);
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
      // Always regenerate key per app start; do not persist it.
      loadedConfig.key = [...Array(10)].map(() => Math.random().toString(36)[2]).join('');
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
      if (typeof loadedConfig.firstRunCompleted !== 'boolean') {
        loadedConfig.firstRunCompleted = true;
        saveConfig(loadedConfig);
      }

      return Object.assign({}, defaultConfig, loadedConfig);
    } catch {
      console.error(`Error reading config file at ${configPath}, using default config`);
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

function saveConfig(config) {
  // Only write revelationDir if non-default loaction
  const saveConfig = {...config};
  delete saveConfig.mdnsEnabled;
  delete saveConfig.key;
  delete saveConfig.runtimeEnableDevTools;
  if(saveConfig.revelationDir === defaultRevelationDir) {
      delete(saveConfig.revelationDir);
  }
  if (Array.isArray(saveConfig.pairedMasters)) {
    saveConfig.pairedMasters = saveConfig.pairedMasters
      .filter((item) => item && item.instanceId)
      .map((item) => ({
        instanceId: item.instanceId,
        name: item.name,
        publicKey: item.publicKey,
        pairedAt: item.pairedAt,
        hostHint: item.hostHint,
        pairingPortHint: item.pairingPortHint,
        pairingPin: item.pairingPin
      }));
  }
  saveConfig.additionalScreens = normalizeAdditionalScreens(saveConfig.additionalScreens);
  fs.writeFileSync(configPath, JSON.stringify(saveConfig, null, 2));
}

function normalizeAdditionalScreens(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const target = item.target === 'display' ? 'display' : 'window';
      const parsedIndex = Number.parseInt(item.displayIndex, 10);
      const displayIndex = Number.isFinite(parsedIndex) && parsedIndex >= 0 ? parsedIndex : null;
      const language = typeof item.language === 'string' ? item.language.trim().toLowerCase() : '';
      const variant = typeof item.variant === 'string' ? item.variant.trim().toLowerCase() : '';
      if (target === 'display' && displayIndex === null) return null;
      return { target, displayIndex, language, variant };
    })
    .filter(Boolean);
}

function findPresentationsDir(customDir = false) {
    let presDir = customDir;
    if (presDir && !fs.existsSync(presDir)) {
      console.error(`Presentations directory ${presDir} does not exist. Using Default.`);
      presDir = false;
    }
    if(!presDir) {
      const baseDir = app.getPath('documents');
      presDir = path.join(baseDir,'REVELation Presentations');
      if (fs.existsSync(presDir)) {
        console.log(`Found presentations directory at: ${presDir}`);
      }
      else {
        console.log(`No presentations directory configured, creating one at ${presDir}`);
        fs.mkdirSync(presDir, { recursive: true });
      }
    }
    if (!fs.existsSync(path.join(presDir,'_media'))) {
      fs.mkdirSync(path.join(presDir,'_media'), { recursive: true });
      console.log(`📁 Created _media folder inside ${presDir}`);
    }
    return path.join(presDir);
}

module.exports = { loadConfig, saveConfig, configPath };
