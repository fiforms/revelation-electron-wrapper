const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { main: initPresentations } = require('../revelation/scripts/init-presentations');


const defaultConfig = {
  mode: 'localhost',
  preferredDisplay: 0,
  logFile: path.join(app.getPath('userData'), 'debug.log'),
  presentationsDir: null,
  viteServerPort: 8000,
  revealRemoteServerPort: 1947,
  revelationDir: app.isPackaged
      ? path.join(process.resourcesPath, 'revelation')
      : path.join(__dirname, '..', 'revelation')
};

const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  if (fs.existsSync(configPath)) {
    try {
      console.log(`Loading config from ${configPath}`);
      const loadedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (!loadedConfig.presentationsDir) {
        loadedConfig.presentationsDir = findPresentationsDir();
        saveConfig(loadedConfig);
        console.warn(`Updated config with presentationsDir: ${loadedConfig.presentationsDir}`);
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
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function findPresentationsDir() {
    const baseDir = app.isPackaged
      ? path.join(process.resourcesPath, 'revelation')
      : path.join(__dirname, '..', 'revelation');
    const prefix = 'presentations_';
    let match = fs.readdirSync(baseDir).find(name =>
      fs.statSync(path.join(baseDir, name)).isDirectory() && name.startsWith(prefix)
    );
    if (!match) {
      console.error(`No presentations directory found in ${baseDir} with prefix ${prefix}`);
      match = initPresentations(baseDir); // Initialize presentations if none found
    }
    return match;
}

module.exports = { loadConfig, saveConfig, configPath };
