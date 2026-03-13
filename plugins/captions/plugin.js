const { spawn } = require('child_process');
const { presentationWindow } = require('../../lib/presentationWindow');

const PLUGIN_NAME = 'captions';
const DEFAULT_HOLD_MS = 5000;
const DEFAULT_MAX_LINES = 2;
const HEARTBEAT_INTERVAL_MS = 3000;
const HEARTBEAT_TIMEOUT_MS = 12000;

function stripAnsi(value) {
  return String(value || '').replace(
    /[\u001b\u009b][[()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]|(?:.[0-9A-ORZcf-nqry=><~]))/g,
    ''
  );
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeCommand(value) {
  return String(value || '').trim();
}

function normalizeOptionalInt(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeOptionalPath(value) {
  const raw = String(value ?? '').trim();
  return raw || '';
}

function quoteShellArg(value) {
  return `"${String(value || '').replace(/(["\\$`])/g, '\\$1')}"`;
}

function isIgnorableOutput(line) {
  if (!line) return true;
  if (line === '[Start speaking]') return true;
  return /^(init:|main:|whisper_|SDL_|system_info:|capture:)/i.test(line);
}

function terminateProcessTree(child, AppContext, reason = 'stop') {
  if (!child || child.killed) {
    return;
  }

  const pid = Number.parseInt(child.pid, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    try {
      child.kill('SIGINT');
    } catch (err) {
      AppContext?.error?.(`[captions-plugin] Failed to stop caption process: ${err.message}`);
    }
    return;
  }

  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
      killer.on('error', (err) => {
        AppContext?.error?.(`[captions-plugin] Failed to taskkill caption process (${reason}): ${err.message}`);
      });
    } catch (err) {
      AppContext?.error?.(`[captions-plugin] Failed to stop caption process (${reason}): ${err.message}`);
    }
    return;
  }

  try {
    // Child is started detached so its descendants share a process group.
    process.kill(-pid, 'SIGINT');
  } catch (err) {
    try {
      child.kill('SIGINT');
    } catch (innerErr) {
      AppContext?.error?.(`[captions-plugin] Failed to stop caption process (${reason}): ${innerErr.message}`);
    }
    if (err?.code !== 'ESRCH') {
      AppContext?.error?.(`[captions-plugin] Failed to signal caption process group (${reason}): ${err.message}`);
    }
  }
}

const captionsPlugin = {
  priority: 97,
  version: '0.1.0',
  exposeToBrowser: true,
  clientHookJS: 'client.js',
  defaultEnabled: false,
  config: {},
  configTemplate: [
    {
      name: 'command',
      type: 'string',
      description: 'Command to launch the caption source (for example: /home/user/programs/whisper.cpp/build/bin/whisper-stream).',
      default: ''
    },
    {
      name: 'modelPath',
      type: 'string',
      description: 'Optional absolute model path passed to the caption command as -m <path>.',
      default: ''
    },
    {
      name: 'inputDevice',
      type: 'number',
      description: 'Optional capture device index passed to the caption command as -c <device>.',
      default: ''
    },
    {
      name: 'autoStart',
      type: 'boolean',
      description: 'Start the caption stream automatically when an Electron presentation window opens.',
      default: true
    },
    {
      name: 'captionHoldMs',
      type: 'number',
      description: 'How long a caption stays visible after the last transcript update.',
      default: DEFAULT_HOLD_MS
    },
    {
      name: 'maxLines',
      type: 'number',
      description: 'Maximum caption lines to keep visible at once.',
      default: DEFAULT_MAX_LINES
    }
  ],

  register(AppContext) {
    this.AppContext = AppContext;
    this.child = null;
    this.buffer = '';
    this.currentLine = '';
    this.finalLines = [];
    this.sessions = new Map();
    this.currentRoomId = '';
    this.state = {
      running: false,
      text: '',
      lines: [],
      roomId: '',
      updatedAt: 0,
      source: 'idle',
      error: ''
    };
    this.clearTimer = null;
    this.sessionSweepTimer = setInterval(() => {
      this.pruneDeadSessions();
    }, HEARTBEAT_INTERVAL_MS);

    process.once('exit', () => {
      this.stopProcess('process-exit');
    });

    AppContext.log('[captions-plugin] Registered');
  },

  api: {},

  presentationApi: {
    'start-session': async (event, data = {}) => {
      return captionsPlugin.startSession(event, data);
    },
    'stop-session': async (event, data = {}) => {
      return captionsPlugin.stopSession(event, data);
    },
    'heartbeat-session': async (event, data = {}) => {
      return captionsPlugin.heartbeatSession(event, data);
    },
    'get-state': async () => {
      return captionsPlugin.getPublicState();
    }
  },

  getConfig() {
    return this.config && typeof this.config === 'object' ? this.config : {};
  },

  getCaptionHoldMs() {
    return parsePositiveInt(this.getConfig().captionHoldMs, DEFAULT_HOLD_MS);
  },

  getMaxLines() {
    return parsePositiveInt(this.getConfig().maxLines, DEFAULT_MAX_LINES);
  },

  getPublicState() {
    return {
      running: this.state.running,
      text: this.state.text,
      lines: [...this.state.lines],
      roomId: this.state.roomId,
      updatedAt: this.state.updatedAt,
      source: this.state.source,
      error: this.state.error
    };
  },

  getSessionCount() {
    return this.sessions instanceof Map ? this.sessions.size : 0;
  },

  getSenderId(event) {
    const sender = event?.sender;
    const id = sender?.id;
    return Number.isFinite(id) ? id : null;
  },

  registerSession(event, data = {}) {
    if (!(this.sessions instanceof Map)) {
      this.sessions = new Map();
    }
    const sender = event?.sender;
    const senderId = this.getSenderId(event);
    if (senderId === null || !sender) return null;

    const now = Date.now();
    const roomId = String(data?.roomId || '').trim();
    const existing = this.sessions.get(senderId);
    const session = {
      sender,
      senderId,
      roomId: roomId || existing?.roomId || '',
      lastSeenAt: now,
      cleanupBound: existing?.cleanupBound === true
    };
    this.sessions.set(senderId, session);

    if (!session.cleanupBound && typeof sender.once === 'function') {
      sender.once('destroyed', () => {
        this.removeSessionBySenderId(senderId, 'renderer-destroyed');
      });
      session.cleanupBound = true;
      this.sessions.set(senderId, session);
    }

    return session;
  },

  removeSessionBySenderId(senderId, reason = 'session-ended') {
    if (!(this.sessions instanceof Map) || !this.sessions.has(senderId)) {
      return;
    }
    const session = this.sessions.get(senderId);
    this.sessions.delete(senderId);

    if (session?.roomId && session.roomId === this.currentRoomId && this.getSessionCount() === 0) {
      this.currentRoomId = '';
      this.state.roomId = '';
    }

    if (this.getSessionCount() === 0) {
      this.stopProcess(reason);
      this.resetTranscript();
      this.pushState({
        running: false,
        source: reason,
        roomId: this.currentRoomId || ''
      });
    }
  },

  pruneDeadSessions() {
    if (!(this.sessions instanceof Map) || this.sessions.size === 0) {
      return;
    }
    const now = Date.now();
    const expired = [];
    for (const [senderId, session] of this.sessions.entries()) {
      const senderDestroyed = !session?.sender || session.sender.isDestroyed?.() === true;
      const stale = !session?.lastSeenAt || now - session.lastSeenAt > HEARTBEAT_TIMEOUT_MS;
      if (senderDestroyed || stale) {
        expired.push(senderId);
      }
    }
    expired.forEach((senderId) => {
      this.removeSessionBySenderId(senderId, 'heartbeat-timeout');
    });
  },

  startSession(event, data = {}) {
    const autoStart = parseBoolean(this.getConfig().autoStart, true);
    const forceStart = data?.forceStart === true;
    const session = this.registerSession(event, data);
    this.currentRoomId = String(data?.roomId || session?.roomId || this.currentRoomId || '').trim();
    if (this.currentRoomId) {
      this.state.roomId = this.currentRoomId;
    }
    this.pushState({ source: 'session-start' });

    if (!autoStart && !forceStart) {
      return this.getPublicState();
    }

    this.ensureProcess();
    return this.getPublicState();
  },

  heartbeatSession(event, data = {}) {
    const session = this.registerSession(event, data);
    if (session) {
      session.lastSeenAt = Date.now();
      this.sessions.set(session.senderId, session);
    }
    return this.getPublicState();
  },

  stopSession(event, data = {}) {
    const roomId = String(data?.roomId || '').trim();
    const senderId = this.getSenderId(event);
    if (senderId !== null) {
      const session = this.sessions.get(senderId);
      if (session && roomId) {
        session.roomId = roomId;
        this.sessions.set(senderId, session);
      }
      this.removeSessionBySenderId(senderId, 'session-stop');
    }

    return this.getPublicState();
  },

  ensureProcess() {
    if (this.child && !this.child.killed) {
      return;
    }

    const command = normalizeCommand(this.getConfig().command);
    if (!command) {
      this.pushState({
        running: false,
        error: 'Caption command is not configured.',
        source: 'config-missing'
      });
      return;
    }

    const modelPath = normalizeOptionalPath(this.getConfig().modelPath);
    const inputDevice = normalizeOptionalInt(this.getConfig().inputDevice);
    const args = [];
    if (modelPath) {
      args.push(`-m ${quoteShellArg(modelPath)}`);
    }
    if (inputDevice !== null) {
      args.push(`-c ${inputDevice}`);
    }
    const fullCommand = [command, ...args].join(' ');
    this.buffer = '';
    this.state.error = '';

    try {
      this.child = spawn(fullCommand, {
        detached: process.platform !== 'win32',
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      this.AppContext.error(`[captions-plugin] Failed to start caption process: ${err.message}`);
      this.child = null;
      this.pushState({
        running: false,
        error: err.message,
        source: 'spawn-error'
      });
      return;
    }

    this.AppContext.log(`[captions-plugin] Launching caption command: ${fullCommand}`);
    this.pushState({
      running: true,
      error: '',
      source: 'process-start'
    });

    this.child.stdout.on('data', (chunk) => {
      this.consumeStdout(chunk);
    });

    this.child.stderr.on('data', (chunk) => {
      const message = stripAnsi(chunk.toString('utf8')).trim();
      if (!message) return;
      this.AppContext.log(`[captions-plugin] stderr: ${message}`);
    });

    this.child.on('error', (err) => {
      this.AppContext.error(`[captions-plugin] Caption process error: ${err.message}`);
      this.pushState({
        running: false,
        error: err.message,
        source: 'process-error'
      });
    });

    this.child.on('close', (code, signal) => {
      this.AppContext.log(`[captions-plugin] Caption process exited (code=${code}, signal=${signal || 'none'})`);
      this.child = null;
      const stoppedByPlugin = this.getSessionCount() <= 0;
      if (!stoppedByPlugin) {
        this.resetTranscript();
      }
      this.pushState({
        running: false,
        source: stoppedByPlugin ? 'process-stop' : 'process-exit',
        error: stoppedByPlugin ? '' : (code ? `Caption process exited with code ${code}.` : '')
      });
    });
  },

  stopProcess(reason = 'stop') {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    if (!this.child || this.child.killed) {
      this.child = null;
      return;
    }
    this.AppContext.log(`[captions-plugin] Stopping caption process (${reason})`);
    terminateProcessTree(this.child, this.AppContext, reason);
  },

  resetTranscript() {
    this.buffer = '';
    this.currentLine = '';
    this.finalLines = [];
    this.state.text = '';
    this.state.lines = [];
    this.state.updatedAt = Date.now();
  },

  consumeStdout(chunk) {
    this.buffer += chunk.toString('utf8');
    let cursor = 0;

    for (let idx = 0; idx < this.buffer.length; idx += 1) {
      const char = this.buffer[idx];
      if (char !== '\r' && char !== '\n') continue;

      const segment = this.buffer.slice(cursor, idx);
      const delimiter = char;
      if (char === '\r' && this.buffer[idx + 1] === '\n') {
        idx += 1;
      }
      cursor = idx + 1;
      this.consumeSegment(segment, delimiter);
    }

    this.buffer = this.buffer.slice(cursor);
  },

  consumeSegment(segment, delimiter) {
    const cleaned = stripAnsi(segment)
      .replace(/\u0008/g, '')
      .replace(/\0/g, '')
      .trim();

    if (isIgnorableOutput(cleaned)) {
      return;
    }

    if (!cleaned) {
      if (delimiter === '\n' && this.currentLine) {
        this.finalizeCurrentLine();
      }
      return;
    }

    if (delimiter === '\n') {
      this.currentLine = cleaned;
      this.finalizeCurrentLine();
      return;
    }

    this.currentLine = cleaned;
    this.publishTranscript('partial-update');
  },

  finalizeCurrentLine() {
    const finalized = String(this.currentLine || '').trim();
    this.currentLine = '';
    if (!finalized) {
      this.publishTranscript('line-finalized');
      return;
    }

    const lastFinal = this.finalLines[this.finalLines.length - 1] || '';
    if (finalized !== lastFinal) {
      this.finalLines.push(finalized);
    } else {
      this.finalLines[this.finalLines.length - 1] = finalized;
    }

    const maxLines = this.getMaxLines();
    while (this.finalLines.length > maxLines) {
      this.finalLines.shift();
    }

    this.publishTranscript('line-finalized');
  },

  buildVisibleLines() {
    const maxLines = this.getMaxLines();
    const lines = [...this.finalLines];
    const partial = String(this.currentLine || '').trim();
    if (partial) {
      if (lines[lines.length - 1] === partial) {
        lines[lines.length - 1] = partial;
      } else {
        lines.push(partial);
      }
    }
    return lines.slice(-maxLines);
  },

  publishTranscript(source = 'update') {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }

    const lines = this.buildVisibleLines();
    this.pushState({
      text: lines.join('\n'),
      lines,
      source,
      error: ''
    });

    const holdMs = this.getCaptionHoldMs();
    if (holdMs > 0) {
      this.clearTimer = setTimeout(() => {
        this.currentLine = '';
        this.finalLines = [];
        this.pushState({
          text: '',
          lines: [],
          source: 'timeout-clear',
          error: ''
        });
      }, holdMs);
    }
  },

  pushState(patch = {}) {
    const nextState = {
      ...this.state,
      ...patch,
      running: patch.running ?? (!!this.child && !this.child.killed),
      roomId: Object.prototype.hasOwnProperty.call(patch, 'roomId')
        ? String(patch.roomId || '').trim()
        : String(this.currentRoomId || this.state.roomId || '').trim(),
      updatedAt: Date.now()
    };
    this.state = nextState;
    this.broadcastEvent('caption-state', this.getPublicState());
  },

  broadcastEvent(type, payload) {
    const windows = [];
    const mainWindow = presentationWindow?.presWindow;
    if (mainWindow && !mainWindow.isDestroyed()) {
      windows.push(mainWindow);
    }

    for (const win of windows) {
      try {
        win.webContents.send('presentation-plugin-event', {
          plugin: PLUGIN_NAME,
          type,
          payload
        });
      } catch (err) {
        this.AppContext.error(`[captions-plugin] Failed to send plugin event: ${err.message}`);
      }
    }
  }
};

module.exports = captionsPlugin;
