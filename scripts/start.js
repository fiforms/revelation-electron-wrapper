const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const env = { ...process.env };

const params = ['.'];

const appName = 'revelation-electron';

// Linux + Wayland only
if (
  process.platform === 'linux' &&
  (env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === 'wayland')
) {
    const ozoneSwitch = setOzonePlatform();
    if(ozoneSwitch) params.push(ozoneSwitch);
}

spawn(
  'electron',
  params,
  {
    stdio: 'inherit',
    env
  }
);

function setOzonePlatform() {
    let AppConfig;

    try {
        const home = os.homedir();
        const configPath = path.join(
            process.env.XDG_CONFIG_HOME || path.join(home, '.config'),
            appName,'config.json');

        AppConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    catch(err) {
        console.log(err);
        console.log('WARNING: Could not load app config in startup');
        return;
    }

    if(!AppConfig || AppConfig.forceX11OnWayland) {
        console.log('Wayland session detected, setting --ozone-platform=x11 per configuration');
        return('--ozone-platform=x11');

    }
    else {
        console.log('Wayland session detected, running under Wayland drivers per configuration');
        console.log('Window placement will be disabled in this mode. Change under settings.');
        return(null);
    }
}