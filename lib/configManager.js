const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const defaultConfig = {
  mode: 'localhost',
  preferredDisplay: 0,
  logFile: path.join(app.getPath('userData'), 'debug.log'),
  presentationsDir: findPresentationsDir(),
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
      return Object.assign({}, defaultConfig, JSON.parse(fs.readFileSync(configPath, 'utf-8')));
    } catch {
      return defaultConfig;
    }
  }
  const config = Object.assign({}, defaultConfig);
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
    const match = fs.readdirSync(baseDir).find(name =>
      fs.statSync(path.join(baseDir, name)).isDirectory() && name.startsWith(prefix)
    );
    if (!match) throw new Error('No presentations_<key> folder found');
    return match;
}

module.exports = { loadConfig, saveConfig, configPath };
