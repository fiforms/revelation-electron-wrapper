// plugins/mediafx/plugin.js
const { BrowserWindow, dialog } = require('electron');

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
            const out = await this.runEffectGenerator(['--list-effects', '--json']);
            const parsed = JSON.parse(out);
            if (!parsed.effects) {
                AppCtx.log('[mediafx] no effects found in effectgenerator output');
                return [];
            }
            const effects = parsed.effects;
            AppCtx.log(`[mediafx] received ${effects.length} effects from effectgenerator`);
            return effects;
        },
        async showOpenMediaDialog() {
            const win = BrowserWindow.getFocusedWindow();
            // Open dialog for selecting many files with .mp4, .webm, .mov, .jpg, .png, .webp extensions
            const result = await dialog.showOpenDialog(win, {
                properties: ['openFile', 'multiSelections'],
                defaultPath: AppCtx.config.presentationsDir,
                filters: [
                    { name: 'Video Files', extensions: ['mp4', 'webm', 'mov'] },
                    { name: 'Image Files', extensions: ['jpg', 'png', 'webp'] }
                ]
            });
            if (result.canceled) {
                return null;
            }
            return result.filePaths;
        },
        async showSaveMediaDialog(opts) {
            const win = BrowserWindow.getFocusedWindow();
            let dialogOptions = {
                filters: [
                    { name: 'Video Files', extensions: ['mp4'] }
                ]
            };
            if (opts && opts.choosefolder) {
                dialogOptions = {
                    properties: ['openDirectory']
                };
            }
            const result = await dialog.showSaveDialog(win, dialogOptions);
            if (result.canceled) {
                return null;
            }
            return result.filePath;
        },
        async startEffectProcess(event, state) {
            AppCtx.log('[mediafx] starting effect process with state:', state);
            if(!state.inputFiles || state.inputFiles.length === 0) {
                throw new Error('No input files specified');
            }
            if(!state.output || !state.output.path) {
                throw new Error('No output path specified');
            }
            if(!state.selectedEffect) {
              // FIXME later: Process the file conversion directly with ffmpeg
                throw new Error('No effect selected');
            }

            const inputFiles = state.inputFiles;
            const outputs = [];

            for(const [index, inputFile] of inputFiles.entries()) {
                const outputPath = inputFiles.length > 1 ?
                    state.output.path + state.output.pattern.replace('{originalname}', inputFile.replace(/^.*[\\\/]/, '').replace(/\.[^/.]+$/, '')).replace('{index}', String(index + 1)).replace('{ext}', state.output.formatPreset)
                    : state.output.path;

                const args = buildArgs(state, inputFile, outputPath);
                AppCtx.log('[mediafx] effectgenerator args:', args);
                const out = await this.runEffectGenerator(args);
                AppCtx.log('[mediafx] effect process completed');
                outputs.push(out);
            }
            return outputs;
        },
        runEffectGenerator(args = []) {
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
    },
    pluginButtons: [
            { "title": "Media FX", "page": "ui.html" },
        ]
};

function buildArgs(state, inputFile, outputPath) {
  const args = [];

  const inputType = inputFile.match(/\.(jpg|jpeg|png|webp)$/i) ? 'image' : 'video';

  args.push('--effect', state.selectedEffect);

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
  if (inputType === 'image') {
    args.push('--background-image', inputFile);
  }
  if (inputType === 'video') {
    args.push('--background-video', inputFile);
  }

  // effect options
  Object.entries(state.effectOptions).forEach(([flag, val]) => {
    if (val === true) args.push(flag);
    else args.push(flag, String(val));
  });

  // output
  args.push('--output', outputPath);
  if (state.output.overwrite) args.push('--overwrite');

  return args;
}