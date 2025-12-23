// plugins/mediafx/plugin.js
const { BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

let AppCtx = null;

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
        async startEffectProcess(event, state, options = {}) {
            AppCtx.log('[mediafx] starting effect process with state:', state);
            if(!state.inputFiles || state.inputFiles.length === 0) {
                throw new Error('No input files specified');
            }
            if(!state.output || !state.output.path) {
                throw new Error('No output path specified');
            }
            if(!state.selectedEffect) {
                throw new Error('No effect selected');
            }

            const concurrency = options.concurrency || DEFAULT_CONCURRENCY;
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

                const args = buildArgs(state, inputFile, outputPath);
                
                // Add to currently processing list
                processInfo.currentlyProcessing.push({
                    file: inputFile,
                    index: index + 1,
                    outputPath: outputPath,
                    duration: 0,
                    currentTime: 0
                });

                try {
                    await this.runEffectGeneratorStreaming(args, processInfo, index);
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
                const binDir = __dirname + '/bin/';
                const effectGeneratorPath = process.platform === 'win32' ? binDir + 'effectgenerator.exe' : binDir + 'effectgenerator';
                execFile(effectGeneratorPath, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
                    if (err) return reject(err);
                    resolve(stdout);
                });
            });
        },
        runEffectGeneratorStreaming(args, processInfo, fileIndex) {
            return new Promise((resolve, reject) => {
                const binDir = __dirname + '/bin/';
                const effectGeneratorPath = process.platform === 'win32' ? binDir + 'effectgenerator.exe' : binDir + 'effectgenerator';
                
                const proc = spawn(effectGeneratorPath, args);

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
                        // If output matches "Duration: 5s", parse and store duration
                        const durationMatch = line.match(/[Dd]uration:\s+([\d.]+)s/);
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
        if (k === 'duration' && inputType === 'video') return; // skip duration for video inputs
        args.push(`--${k}`, String(v));
    });

    // audio
    if (inputType === 'video' && state.audio.codec) {
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