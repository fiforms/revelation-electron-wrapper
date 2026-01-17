const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const crypto = require('crypto');
const { defaultInstanceName } = require('./mdnsManager');
const { generateKeyPair } = require('./peerAuth');
const { main: initPresentations } = require('../revelation/scripts/init-presentations');

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
  ffmpegPath: null,
  ffprobePath: null,
  forceX11OnWayland: true,
  plugins: ["addmedia","bibletext","hymnary","virtualbiblesnapshots", "resources", "mediafx"],
  pluginConfigs: {},
  language: 'en',
  mdnsEnabled: false,
  mdnsInstanceName: defaultInstanceName(),
  mdnsInstanceId: crypto.randomBytes(8).toString('hex'),
  mdnsAuthToken: crypto.randomBytes(32).toString('hex'),
  rsaPublicKey: null,
  rsaPrivateKey: null,
  pairedMasters: [],
  revelationDir: defaultRevelationDir
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
      if (!loadedConfig.presentationsDir) {
        loadedConfig.presentationsDir = findPresentationsDir();
        saveConfig(loadedConfig);
        console.warn(`Updated config with presentationsDir: ${loadedConfig.presentationsDir}`);
      }
      if (!loadedConfig.key) {
        loadedConfig.key = [...Array(10)].map(() => Math.random().toString(36)[2]).join('');
        saveConfig(loadedConfig);
        console.warn(`Updated config with key: ${loadedConfig.key}`);
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
  saveConfig(config);
  console.warn(`Config file not found, created default at ${configPath}`);
  return config;
}

function saveConfig(config) {
  // Only write revelationDir if non-default loaction
  const saveConfig = {...config};
  if(saveConfig.revelationDir === defaultRevelationDir) {
      delete(saveConfig.revelationDir);
  }
  fs.writeFileSync(configPath, JSON.stringify(saveConfig, null, 2));
}

function findPresentationsDir() {
    const baseDir = app.getPath('documents');
    const presDir = path.join(baseDir,'REVELation Presentations');
    if (fs.existsSync(presDir)) {
      console.error(`No presentations directory configured, but a matching one found at ${presDir}`);
      return presDir;
    }
    initPresentations(baseDir,'REVELation Presentations'); // Initialize presentations if none found
    return path.join(presDir);
}

module.exports = { loadConfig, saveConfig, configPath };
