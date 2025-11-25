const fs = require('fs');
const path = require('path');
const { app } = require('electron');
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
  plugins: ["addmedia","bibletext","hymnary","virtualbiblesnapshots", "resources"],
  pluginConfigs: {},
  language: 'en',
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

      return Object.assign({}, defaultConfig, loadedConfig);
    } catch {
      console.error(`Error reading config file at ${configPath}, using default config`);
      defaultConfig.presentationsDir = findPresentationsDir();
      return defaultConfig;
    }
  }
  const config = Object.assign({}, defaultConfig);
  config.presentationsDir = findPresentationsDir();
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
