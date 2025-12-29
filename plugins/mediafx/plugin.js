// plugins/mediafx/plugin.js
const { BrowserWindow, dialog, app } = require('electron');
const { spawn } = require('child_process');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

let AppCtx = null;
let mediaPickerWindow = null;
let mediaPickerResolver = null;
let mediaPickerPromise = null;

// Track running processes
const runningProcesses = new Map();
let processIdCounter = 0;

// Concurrency control
const DEFAULT_CONCURRENCY = 2;

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
            try {
                const out = await this.runEffectGenerator(['--list-effects', '--json']);
                const parsed = JSON.parse(out);
                if (!parsed.effects) {
                    AppCtx.log('[mediafx] no effects found in effectgenerator output');
                    return getFfmpegEffects();
                }
                const effects = parsed.effects.map(effect => ({
                    ...effect,
                    engine: 'effectgenerator'
                }));
                const ffmpegEffects = getFfmpegEffects();
                AppCtx.log(`[mediafx] received ${effects.length} effects from effectgenerator`);
                return effects.concat(ffmpegEffects);
            } catch (err) {
                AppCtx.log(`[mediafx] failed to list effects via effectgenerator: ${err.message}`);
                return getFfmpegEffects();
            }
        },
        async showOpenMediaDialog() {
            const win = BrowserWindow.getFocusedWindow();
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
        async showSaveMediaDialog(event, opts) {
            const win = BrowserWindow.getFocusedWindow();
            let result;
            let savePath;
            console.log('mediafx: showSaveMediaDialog called with opts:', opts);
            if (opts && opts.choosefolder) {
                result = await dialog.showOpenDialog(win, {
                    properties: ['openDirectory']
                });
                savePath = result.filePaths ? result.filePaths[0] + '/' : null;
            }
            else {
                result = await dialog.showSaveDialog(win, {
                    filters: [
                        { name: 'Video Files', extensions: ['mp4'] }
                    ]
                });
                savePath = result.filePath;
            }
            if (result.canceled) {
                return null;
            }
            return savePath;
        },

        async showMediaLibraryDialog() {
            const { BrowserWindow } = require('electron');

            const key = AppCtx.config.key; // ✅ required for correct namespace

            const query = `?key=${encodeURIComponent(key)}&nosidebar=1`;
            const url = `http://${AppCtx.hostURL}:${AppCtx.config.viteServerPort}/plugins_${key}/mediafx/media-picker.html${query}`;

            if (mediaPickerWindow && !mediaPickerWindow.isDestroyed()) {
                mediaPickerWindow.focus();
                return mediaPickerPromise;
            }

            const win = new BrowserWindow({
                width: 900,
                height: 700,
                parent: AppCtx.win,
                webPreferences: { preload: AppCtx.preload },
            });
            // win.webContents.openDevTools();  // Uncomment for debugging

            mediaPickerWindow = win;

            win.setMenu(null);
            AppCtx.log(`[mediafx] Opening media library picker: ${url}`);
            win.loadURL(url);

            mediaPickerPromise = new Promise((resolve) => {
                mediaPickerResolver = resolve;
                win.on('closed', () => {
                    if (mediaPickerResolver) {
                        mediaPickerResolver(null);
                        mediaPickerResolver = null;
                    }
                    mediaPickerWindow = null;
                    mediaPickerPromise = null;
                });
            });
            return mediaPickerPromise;
        },

        async insertSelectedMedia(event, data) {
            const item = data.item;
            console.log('[mediafx] insertSelectedMedia called with item:', item);
            if (!mediaPickerWindow || mediaPickerWindow.isDestroyed()) {
                return { success: false, error: 'No active media picker window' };
            }

            if (!item) {
                if (!mediaPickerWindow.isDestroyed()) {
                    mediaPickerWindow.close();
                }
                if (mediaPickerResolver) {
                    mediaPickerResolver(null);
                    mediaPickerResolver = null;
                }
                return { success: true, canceled: true };
            }

            const filePath = path.join(AppCtx.config.presentationsDir, '_media', item.filename);
            const selection = {
                item,
                filePath,
                title: item.title || item.original_filename || item.filename
            };

            if (mediaPickerResolver) {
                mediaPickerResolver(selection);
                mediaPickerResolver = null;
            }

            if (!mediaPickerWindow.isDestroyed()) {
                mediaPickerWindow.close();
            }
            return { success: true };

        },

        async startEffectProcess(event, state, options = {}) {
            AppCtx.log('[mediafx] starting effect process with state:', state);
            if(!state.inputFiles || state.inputFiles.length === 0) {
                throw new Error('No input files specified');
            }
            if(!state.output || !state.output.path) {
                throw new Error('No output path specified');
            }

            const concurrency = options.concurrency || state.output.concurrency || DEFAULT_CONCURRENCY;
            processIdCounter++;
            const processId = `process_${processIdCounter}`;

            const processInfo = {
                id: processId,
                status: 'running',
                startTime: Date.now(),
                totalFiles: state.inputFiles.length,
                completedFiles: 0,
                failedFiles: 0,
                currentlyProcessing: [],
                outputs: [],
                errors: [],
                duration: 0,
                currentTime: 0,
                concurrency: concurrency
            };

            runningProcesses.set(processId, processInfo);

            // Process files asynchronously with concurrency control
            this.processFilesWithConcurrency(processId, state, concurrency).catch(err => {
                AppCtx.log('[mediafx] error in async processing:', err);
                const proc = runningProcesses.get(processId);
                if (proc) {
                    proc.status = 'error';
                    proc.errors.push(err.message);
                }
            });

            return { processId, concurrency };
        },
        async processFilesWithConcurrency(processId, state, concurrency) {
            const processInfo = runningProcesses.get(processId);
            if (!processInfo) return;

            const ffmpegEffect = getFfmpegEffectByName(state.selectedEffect);
            const useFfmpeg = isNoEffectSelected(state.selectedEffect) ||
                state.selectedEffectEngine === 'ffmpeg' ||
                !!ffmpegEffect;

            const inputFiles = state.inputFiles;
            const queue = inputFiles.map((file, index) => ({ file, index }));
            let activePromises = [];

            const processNextFile = async () => {
                if (queue.length === 0) return null;
                if (processInfo.status === 'cancelled') return null;

                const { file: inputFile, index } = queue.shift();

                const outputPath = inputFiles.length > 1 ?
                    state.output.path + state.output.pattern
                        .replace('{originalname}', inputFile.replace(/^.*[\\\/]/, '').replace(/\.[^/.]+$/, ''))
                        .replace('{index}', String(index + 1))
                        .replace('{ext}', state.output.formatPreset)
                    : state.output.path;

                const plannedDuration = useFfmpeg ? await getMediaDurationSeconds(inputFile, state) : 0;
                const inputDimensions = useFfmpeg ?
                    await getMediaDimensions(inputFile) :
                    null;
                const args = useFfmpeg ?
                    buildFfmpegArgs(state, inputFile, outputPath, ffmpegEffect, inputDimensions) :
                    buildArgs(state, inputFile, outputPath);
                
                // Add to currently processing list
                processInfo.currentlyProcessing.push({
                    file: inputFile,
                    index: index + 1,
                    outputPath: outputPath,
                    duration: plannedDuration || 0,
                    currentTime: 0
                });

                try {
                    if (useFfmpeg) {
                        await this.runFfmpegStreaming(args, processInfo, index);
                    } else {
                        await this.runEffectGeneratorStreaming(args, processInfo, index);
                    }
                    processInfo.outputs.push(outputPath);
                    processInfo.completedFiles++;
                } catch (err) {
                    processInfo.errors.push(`File ${inputFile}: ${err.message}`);
                    processInfo.failedFiles++;
                } finally {
                    // Remove from currently processing list
                    processInfo.currentlyProcessing = processInfo.currentlyProcessing.filter(
                        item => item.file !== inputFile
                    );
                }

                // Process next file in queue
                return processNextFile();
            };

            // Start initial batch of concurrent processes
            for (let i = 0; i < Math.min(concurrency, inputFiles.length); i++) {
                activePromises.push(processNextFile());
            }

            // Wait for all files to complete
            await Promise.all(activePromises);

            // Mark process as complete
            if (processInfo.status === 'cancelled') {
                processInfo.status = 'cancelled';
            } else if (processInfo.errors.length > 0) {
                processInfo.status = 'completed_with_errors';
            } else {
                processInfo.status = 'completed';
            }
            
            processInfo.endTime = Date.now();
            const duration = ((processInfo.endTime - processInfo.startTime) / 1000).toFixed(2);
            
            AppCtx.log(`[mediafx] process ${processId} finished with status: ${processInfo.status}`);
            if(processInfo.errors.length > 0) {
                AppCtx.log(`[mediafx] process ${processId} encountered errors:`, processInfo.errors);
            }
            AppCtx.log(`[mediafx] process ${processId} duration: ${duration} seconds`);
        },
        getProcessStatus(event, processId) {
            const processInfo = runningProcesses.get(processId);
            if (!processInfo) {
                return { error: 'Process not found' };
            }

            return {
                id: processInfo.id,
                status: processInfo.status,
                progress: processInfo.totalFiles > 0 ? 
                    (processInfo.completedFiles / processInfo.totalFiles) * 100 : 0,
                completedFiles: processInfo.completedFiles,
                failedFiles: processInfo.failedFiles,
                totalFiles: processInfo.totalFiles,
                currentlyProcessing: processInfo.currentlyProcessing,
                outputs: processInfo.outputs,
                errors: processInfo.errors,
                concurrency: processInfo.concurrency,
                startTime: processInfo.startTime,
                endTime: processInfo.endTime,
                duration: processInfo.endTime ? 
                    processInfo.endTime - processInfo.startTime : 
                    Date.now() - processInfo.startTime
            };
        },
        getAllProcesses() {
            const processinfo = {
                count: 0,
                processes: []
            };
            runningProcesses.forEach((info, id) => {
                processinfo.count++;
                
                // Calculate aggregate progress from currently processing files
                const totalDuration = info.currentlyProcessing.reduce((sum, f) => sum + (f.duration || 0), 0);
                const totalCurrentTime = info.currentlyProcessing.reduce((sum, f) => sum + (f.currentTime || 0), 0);
                
                processinfo.processes.push({
                    id,
                    status: info.status,
                    completedFiles: info.completedFiles,
                    totalFiles: info.totalFiles,
                    startTime: info.startTime,
                    currentlyProcessing: info.currentlyProcessing, // Include per-file progress
                    aggregateDuration: totalDuration,
                    aggregateProgress: totalCurrentTime
                });
            });
            return processinfo;
        },
        cancelProcess(event, processId) {
            const processInfo = runningProcesses.get(processId);
            if (!processInfo) {
                return { error: 'Process not found' };
            }
            if (processInfo.status === 'running') {
                processInfo.status = 'cancelled';
                
                // Kill all currently running child processes
                if (processInfo.childProcesses) {
                    processInfo.childProcesses.forEach((proc, fileIndex) => {
                        try {
                            proc.kill();
                            AppCtx.log(`[mediafx] killed child process for file ${fileIndex}`);
                        } catch (err) {
                            AppCtx.log(`[mediafx] error killing child process: ${err.message}`);
                        }
                    });
                }
                
                return { success: true, message: 'Process cancelled, killing active child processes' };
            }
            return { error: 'Process is not running' };
        },
        clearProcess(event, processId) {
            const deleted = runningProcesses.delete(processId);
            return { success: deleted };
        },
        runEffectGenerator(args = []) {
            return new Promise((resolve, reject) => {

                const effectGeneratorPath = getEffectGeneratorPath();

                // Set environment variables for ffmpeg/ffprobe if specified
                const env = getEnv();
                execFile(effectGeneratorPath, args, { maxBuffer: 10 * 1024 * 1024, env }, (err, stdout) => {
                    if (err) return reject(err);
                    resolve(stdout);
                });
            });
        },
        runEffectGeneratorStreaming(args, processInfo, fileIndex) {
            return new Promise((resolve, reject) => {
                const effectGeneratorPath = getEffectGeneratorPath();
                const env = getEnv();
                const proc = spawn(effectGeneratorPath, args, { env });

                // Store child process reference for this specific file
                if (!processInfo.childProcesses) {
                    processInfo.childProcesses = new Map();
                }
                processInfo.childProcesses.set(fileIndex, proc);

                proc.stdout.on('data', (data) => {
                    const output = data.toString();

                    // output could contain multiple lines, if so process each line
                    const outputs = output.split('\n').map(line => line.trim()).filter(line => line.length > 0);

                    // Find this file in currentlyProcessing
                    const currentFile = processInfo.currentlyProcessing.find(f => f.index === fileIndex + 1);
    
                    outputs.forEach(line => {
                        console.log('[mediafx] effectgenerator output:', line);
                        // If output matches "Duration: 5s" or "Auto-detected background video duration: 203.8s (6114 frames)"
                        const durationMatch = line.match(/^(?:Duration|Auto-detected background video duration):\s+([\d.]+)s\b/);
                        if (durationMatch) {
                            currentFile.duration = parseFloat(durationMatch[1]);
                        }
                    
                        // If output matches "Progress: 3 seconds", parse and store current time
                        const progressMatch = line.match(/Progress:\s+([\d.]+) seconds/);
                        if (progressMatch) {
                            currentFile.currentTime = parseFloat(progressMatch[1]);
                        }
                        processInfo.outputs.push(line);
                    });
                });

                proc.stderr.on('data', (data) => {
                    const err = data.toString();
                    processInfo.errors.push(err);
                });

                proc.on('close', (code) => {
                    processInfo.childProcesses.delete(fileIndex);
                    
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Process exited with code ${code}`));
                    }
                });

                proc.on('error', (err) => {
                    processInfo.childProcesses.delete(fileIndex);
                    reject(err);
                });
            });
        },
        runFfmpegStreaming(args, processInfo, fileIndex) {
            return new Promise((resolve, reject) => {
                let ffmpeg = ffmpegPath();
                if (!ffmpeg) {
                    ffmpeg = 'ffmpeg'; // Fallback to system ffmpeg
                }
                const env = getEnv();
                const proc = spawn(ffmpeg, args, { env });

                if (!processInfo.childProcesses) {
                    processInfo.childProcesses = new Map();
                }
                processInfo.childProcesses.set(fileIndex, proc);

                const currentFile = processInfo.currentlyProcessing.find(f => f.index === fileIndex + 1);

                proc.stderr.on('data', (data) => {
                    const output = data.toString();
                    const lines = output.split('\n').map(line => line.trim()).filter(line => line.length > 0);

                    lines.forEach(line => {
                        const durationMatch = line.match(/Duration:\s+(\d+:\d+:\d+(?:\.\d+)?)/);
                        if (durationMatch && currentFile && (!currentFile.duration || currentFile.duration === 0)) {
                            currentFile.duration = parseFfmpegTimestamp(durationMatch[1]);
                        }

                        const timeMatch = line.match(/time=(\d+:\d+:\d+(?:\.\d+)?)/);
                        if (timeMatch && currentFile) {
                            currentFile.currentTime = parseFfmpegTimestamp(timeMatch[1]);
                        }
                    });
                });

                proc.stdout.on('data', (data) => {
                    processInfo.outputs.push(data.toString());
                });

                proc.on('close', (code) => {
                    processInfo.childProcesses.delete(fileIndex);
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`ffmpeg exited with code ${code}`));
                    }
                });

                proc.on('error', (err) => {
                    processInfo.childProcesses.delete(fileIndex);
                    reject(err);
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
    const videoArgMap = {
        maxFade: 'max-fade'
    };

    const inputType = inputFile.match(/\.(jpg|jpeg|png|webp)$/i) ? 'image' : 'video';

    args.push('--effect', state.selectedEffect);

    // video
    Object.entries(state.video).forEach(([k, v]) => {
        if (v === null || v === undefined || v === '') return;
        if (k === 'duration' && inputType === 'video') return; // skip duration for video inputs
        const flag = videoArgMap[k] || k;
        args.push(`--${flag}`, String(v));
    });

    // audio
    if (inputType === 'video' && state.audio.codec) {
        args.push('--audio-codec', state.audio.codec);
        if (state.audio.codec !== 'copy' && state.audio.bitrate !== null && state.audio.bitrate !== undefined) {
            args.push('--audio-bitrate', state.audio.bitrate);
        }
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

function buildFfmpegArgs(state, inputFile, outputPath, effect, inputDimensions) {
    const args = [];
    const inputType = inputFile.match(/\.(jpg|jpeg|png|webp)$/i) ? 'image' : 'video';
    const video = state.video || {};
    const scaleOnlyWhenNeeded = !!effect;
    console.log('[mediafx] building ffmpeg args for input:', inputFile, 'output:', outputPath, 'effect:', effect, 'inputDimensions:', inputDimensions);

    if (state.output.overwrite) {
        args.push('-y');
    } else {
        args.push('-n');
    }

    if (inputType === 'image') {
        args.push('-loop', '1');
    }

    args.push('-i', inputFile);

    if (inputType === 'image' && video.duration) {
        args.push('-t', String(video.duration));
    }

    const filterChain = [];
    const targetWidth = parseInt(video.width, 10);
    const targetHeight = parseInt(video.height, 10);
    const inputWidth = inputDimensions && inputDimensions.width ? inputDimensions.width : null;
    const inputHeight = inputDimensions && inputDimensions.height ? inputDimensions.height : null;
    const hasTargetSize = Number.isFinite(targetWidth) && Number.isFinite(targetHeight);
    const hasInputSize = Number.isFinite(inputWidth) && Number.isFinite(inputHeight);
    const needsScale = hasTargetSize && hasInputSize &&
        (targetWidth !== inputWidth || targetHeight !== inputHeight);
    if (hasTargetSize && (!scaleOnlyWhenNeeded || needsScale)) {
        filterChain.push(`scale=${targetWidth}:${targetHeight}`);
    }
    if (video.fps) {
        filterChain.push(`fps=${video.fps}`);
    }

    if (effect && effect.vf) {
        const templateData = buildEffectTemplateData(state);
        const rendered = applyTemplate(effect.vf, templateData).trim();
        if (rendered) {
            filterChain.push(rendered);
        }
    }

    if (filterChain.length > 0) {
        args.push('-vf', filterChain.join(','));
    }

    args.push(...getVideoCodecArgs(state.output.formatPreset, video));

    if (inputType === 'image' || !state.audio || !state.audio.codec) {
        args.push('-an');
    } else if (state.audio.codec === 'copy') {
        args.push('-c:a', 'copy');
    } else {
        args.push('-c:a', state.audio.codec);
        if (state.audio.bitrate) {
            args.push('-b:a', `${state.audio.bitrate}k`);
        }
    }

    args.push(outputPath);
    return args;
}

function getVideoCodecArgs(formatPreset, video) {
    const crf = video && video.crf !== undefined ? video.crf : 23;
    switch (formatPreset) {
        case 'webm':
            return ['-c:v', 'libsvtav1', '-preset', '7','-crf', String(crf), '-b:v', '0'];
        case 'mov':
            return ['-c:v', 'prores_ks', '-profile:v', '3', '-qscale:v', String(crf)];
        case 'mp4':
        default:
            return ['-c:v', 'libx264', '-crf', String(crf), '-pix_fmt', 'yuv420p'];
    }
}

function buildEffectTemplateData(state) {
    const data = {};
    Object.entries(state.video || {}).forEach(([key, value]) => {
        data[key] = value;
    });
    Object.entries(state.effectOptions || {}).forEach(([key, value]) => {
        if (typeof value === 'boolean') {
            data[key] = value ? 1 : 0;
        } else {
            data[key] = value;
        }
    });
    return data;
}

function applyTemplate(template, data) {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
        if (data[key] === undefined || data[key] === null) return '';
        return String(data[key]);
    });
}

function isNoEffectSelected(selectedEffect) {
    return !selectedEffect || selectedEffect === 'none';
}

function getFfmpegEffects() {
    const effectsPath = path.join(__dirname, 'ffmpeg-effects.json');
    if (!fs.existsSync(effectsPath)) {
        return [];
    }
    try {
        const raw = fs.readFileSync(effectsPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const effects = Array.isArray(parsed.effects) ? parsed.effects : [];
        return effects.map(effect => ({
            ...effect,
            engine: 'ffmpeg',
            options: Array.isArray(effect.options) ? effect.options : []
        }));
    } catch (err) {
        if (AppCtx && AppCtx.log) {
            AppCtx.log(`[mediafx] failed to load ffmpeg effects: ${err.message}`);
        }
        return [];
    }
}

function getFfmpegEffectByName(name) {
    if (!name) return null;
    const effects = getFfmpegEffects();
    return effects.find(effect => effect.name === name) || null;
}

async function getMediaDurationSeconds(inputFile, state) {
    const isImage = inputFile.match(/\.(jpg|jpeg|png|webp)$/i);
    if (isImage) {
        const duration = state.video && state.video.duration ? parseFloat(state.video.duration) : 0;
        return Number.isFinite(duration) ? duration : 0;
    }
    let ffprobe = ffprobePath();
    if (!ffprobe) {
        ffprobe = 'ffprobe'; // Fallback to system ffprobe
    }
    return new Promise((resolve) => {
        execFile(ffprobe, [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            inputFile
        ], { env: getEnv() }, (err, stdout) => {
            if (err) return resolve(0);
            const duration = parseFloat(String(stdout).trim());
            resolve(Number.isFinite(duration) ? duration : 0);
        });
    });
}

async function getMediaDimensions(inputFile) {
    let ffprobe = ffprobePath();
    if (!ffprobe) {
        ffprobe = 'ffprobe'; // Fallback to system ffprobe
    }
    return new Promise((resolve) => {
        execFile(ffprobe, [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height',
            '-of', 'csv=p=0:s=x',
            inputFile
        ], { env: getEnv() }, (err, stdout) => {
            if (err) return resolve(null);
            const value = String(stdout).trim();
            const match = value.match(/^(\d+)x(\d+)$/);
            if (!match) return resolve(null);
            resolve({ width: parseInt(match[1], 10), height: parseInt(match[2], 10) });
        });
    });
}

function parseFfmpegTimestamp(timestamp) {
    const parts = timestamp.split(':').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) {
        return 0;
    }
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function ffmpegPath() {
    if(AppCtx.config.ffmpegPath)  return AppCtx.config.ffmpegPath;

    const ffmpegPathCandidate = path.join(
        process.resourcesPath,
        'ffmpeg',
        process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    );
    if (fs.existsSync(ffmpegPathCandidate)) {
        return ffmpegPathCandidate;
    }
}

function ffprobePath() {
    if(AppCtx.config.ffprobePath)  return AppCtx.config.ffprobePath;

    const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const ffprobeCandidates = [
        path.join(process.resourcesPath, 'ffprobe', process.platform, process.arch, ffprobeName),
        path.join(process.resourcesPath, 'ffprobe', 'bin', process.platform, process.arch, ffprobeName),
        path.join(process.resourcesPath, 'ffprobe', ffprobeName)
    ];
    for (const ffprobePathCandidate of ffprobeCandidates) {
        if (fs.existsSync(ffprobePathCandidate)) {
            return ffprobePathCandidate;
        }
    }
}

function getEnv() {
    const env = Object.assign({}, process.env);

    const ffmpeg = ffmpegPath();
    if (ffmpeg) {
        env.FFMPEG_PATH = ffmpeg;
        AppCtx.log(`[mediafx] using FFMPEG_PATH: ${ffmpeg}`);
    } else {
        AppCtx.log('[mediafx] no FFMPEG_PATH set');
    }

    const ffprobe = ffprobePath();
    if (ffprobe) {
        env.FFPROBE_PATH = ffprobe;
        AppCtx.log(`[mediafx] using FFPROBE_PATH: ${ffprobe}`);
    } else {
        AppCtx.log('[mediafx] no FFPROBE_PATH set');
    }

    return env;
}

function getEffectGeneratorPath() {
    let effectGeneratorPath;
    if(app.isPackaged) {
        effectGeneratorPath = path.join(process.resourcesPath, 'bin',
            process.platform === 'win32' ? 'effectgenerator.exe' : 'effectgenerator');
    }
    else {
        effectGeneratorPath = path.join(__dirname, '..', '..', 'bin',
            process.platform === 'win32' ? 'effectgenerator.exe' : 'effectgenerator');
    }
    return effectGeneratorPath;
}
