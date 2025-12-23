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
const DEFAULT_CONCURRENCY = 3;

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
            const processId = `process_${++processIdCounter}_${Date.now()}`;
            const logDir = path.join(__dirname, 'logs');
            
            // Ensure log directory exists
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }

            const logFile = path.join(logDir, `${processId}.log`);
            const logStream = fs.createWriteStream(logFile, { flags: 'a' });

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
                logFile: logFile,
                concurrency: concurrency
            };

            runningProcesses.set(processId, processInfo);

            logStream.write(`=== MediaFX Process Started ===\n`);
            logStream.write(`Process ID: ${processId}\n`);
            logStream.write(`Total Files: ${state.inputFiles.length}\n`);
            logStream.write(`Concurrency: ${concurrency}\n`);
            logStream.write(`Effect: ${state.selectedEffect}\n\n`);

            // Process files asynchronously with concurrency control
            this.processFilesWithConcurrency(processId, state, logStream, concurrency).catch(err => {
                AppCtx.log('[mediafx] error in async processing:', err);
                const proc = runningProcesses.get(processId);
                if (proc) {
                    proc.status = 'error';
                    proc.errors.push(err.message);
                }
            });

            return { processId, logFile, concurrency };
        },
        async processFilesWithConcurrency(processId, state, logStream, concurrency) {
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
                    outputPath: outputPath
                });

                logStream.write(`\n[${new Date().toISOString()}] Starting file ${index + 1}/${inputFiles.length}: ${inputFile}\n`);
                logStream.write(`Command: effectgenerator ${args.join(' ')}\n`);
                logStream.write(`Output: ${outputPath}\n\n`);

                try {
                    await this.runEffectGeneratorStreaming(args, logStream, processInfo, index);
                    processInfo.outputs.push(outputPath);
                    processInfo.completedFiles++;
                    logStream.write(`\n[${new Date().toISOString()}] ✓ Completed (${processInfo.completedFiles}/${inputFiles.length}): ${outputPath}\n`);
                } catch (err) {
                    processInfo.errors.push(`File ${inputFile}: ${err.message}`);
                    processInfo.failedFiles++;
                    logStream.write(`\n[${new Date().toISOString()}] ✗ Error: ${err.message}\n`);
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
            
            logStream.write(`\n=== Process ${processInfo.status} ===\n`);
            logStream.write(`Total Duration: ${duration}s\n`);
            logStream.write(`Completed: ${processInfo.completedFiles}/${processInfo.totalFiles}\n`);
            logStream.write(`Failed: ${processInfo.failedFiles}\n`);
            logStream.end();
            
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
                logFile: processInfo.logFile,
                concurrency: processInfo.concurrency,
                startTime: processInfo.startTime,
                endTime: processInfo.endTime,
                duration: processInfo.endTime ? 
                    processInfo.endTime - processInfo.startTime : 
                    Date.now() - processInfo.startTime
            };
        },
        getAllProcesses() {
            const processes = [];
            runningProcesses.forEach((info, id) => {
                processes.push({
                    id,
                    status: info.status,
                    completedFiles: info.completedFiles,
                    totalFiles: info.totalFiles,
                    startTime: info.startTime
                });
            });
            return processes;
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
        runEffectGeneratorStreaming(args, logStream, processInfo, fileIndex) {
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
                    logStream.write(output);
                });

                proc.stderr.on('data', (data) => {
                    const output = data.toString();
                    logStream.write(`STDERR: ${output}`);
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