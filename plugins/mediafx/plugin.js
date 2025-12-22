// plugins/mediafx/plugin.js
const { BrowserWindow } = require('electron');

const { execFile } = require('child_process');

let AppCtx = null;

module.exports = {
    priority: 104,
    version: '0.1.0',

    register(AppContext) {
        AppCtx = AppContext;
        AppContext.log('[mediafx] plugin registered');
    },
    api: {
        async listEffects() {
            AppCtx.log('[mediafx] listing effects via effectgenerator');
            const out = await runEffectGenerator(['--list-effects', '--json']);
            const parsed = JSON.parse(out);
            if (!parsed.effects) {
                AppCtx.log('[mediafx] no effects found in effectgenerator output');
                return [];
            }
            const effects = parsed.effects;
            AppCtx.log(`[mediafx] received ${effects.length} effects from effectgenerator`);
            return effects;
        }
    },
    pluginButtons: [
            { "title": "Media FX", "page": "ui.html" },
        ]
};

function runEffectGenerator(args = []) {
  return new Promise((resolve, reject) => {

    // effectgenerator will be bundled with the plugin in plugins/mediafx/bin/effectgenerator (or effectgenerator.exe on Windows)
    const binDir = __dirname + '/bin/';
    const effectGeneratorPath = process.platform === 'win32' ? binDir + 'effectgenerator.exe' : binDir + 'effectgenerator';
    execFile(effectGeneratorPath, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

function buildArgs(state) {
  const args = [];

  args.push('--effect', state.selectedEffect.name);

  // video
  Object.entries(state.video).forEach(([k, v]) => {
    args.push(`--${k}`, String(v));
  });

  // audio
  if (state.audio.codec) {
    args.push('--audio-codec', state.audio.codec);
    args.push('--audio-bitrate', state.audio.bitrate);
  }

  // background
  if (state.background.type === 'image') {
    args.push('--background-image', state.background.path);
  }
  if (state.background.type === 'video') {
    args.push('--background-video', state.background.path);
  }

  // effect options
  Object.entries(state.effectOptions).forEach(([flag, val]) => {
    if (val === true) args.push(flag);
    else args.push(flag, String(val));
  });

  // output
  args.push('--output', state.output.path);
  if (state.output.overwrite) args.push('--overwrite');

  return args;
}