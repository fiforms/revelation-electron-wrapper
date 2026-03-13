(function () {
  const PLUGIN_NAME = 'captions';
  const SOCKET_PATH = '/presenter-plugins-socket';
  const HEARTBEAT_INTERVAL_MS = 3000;

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

  function normalizeText(value) {
    return String(value || '').replace(/\r/g, '').trim();
  }

  window.RevelationPlugins = window.RevelationPlugins || {};
  window.RevelationPlugins[PLUGIN_NAME] = {
    name: PLUGIN_NAME,
    context: null,
    overlay: null,
    overlayText: null,
    pluginSocket: null,
    pluginSocketConnected: false,
    pluginSocketJoinPending: false,
    pluginSocketRoomId: '',
    roomLookupRetryTimer: null,
    localUnsubscribe: null,
    heartbeatTimer: null,
    state: {
      text: '',
      lines: [],
      visibilityEnabled: true,
      visibilityTouched: false,
      localServiceRunning: false,
      remoteServiceRunning: false,
      updatedAt: 0
    },

    init(context) {
      this.context = context || {};
      this.state.visibilityEnabled = this.readAutoStartConfig();
      this.ensureOverlay();
      this.bindLifecycle();
      this.tryConnectPresenterPluginSocket({ allowMasterLookup: true, quietIfMissing: true });
      this.bootstrapLocalSession();
    },

    readAutoStartConfig() {
      return parseBoolean(this.context?.config?.autoStart, true);
    },

    bindLifecycle() {
      window.addEventListener('beforeunload', () => {
        this.cleanup();
      }, { once: true });
    },

    cleanup() {
      if (typeof this.localUnsubscribe === 'function') {
        try {
          this.localUnsubscribe();
        } catch {
          // Ignore local listener cleanup failures.
        }
      }
      this.localUnsubscribe = null;

      const roomId = this.getRoomIdFromLocation({ allowMasterLookup: true });
      if (this.hasLocalCaptionControl()) {
        window.electronAPI.presentationPluginTrigger(PLUGIN_NAME, 'stop-session', { roomId }).catch(() => {});
      }

      if (this.heartbeatTimer) {
        window.clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }

      if (this.roomLookupRetryTimer) {
        window.clearTimeout(this.roomLookupRetryTimer);
        this.roomLookupRetryTimer = null;
      }

      if (this.pluginSocket) {
        try {
          this.pluginSocket.removeAllListeners();
          this.pluginSocket.disconnect();
        } catch {
          // Ignore disconnect cleanup failures.
        }
      }
      this.pluginSocket = null;
      this.pluginSocketConnected = false;
      this.pluginSocketJoinPending = false;
    },

    bootstrapLocalSession() {
      if (!this.hasLocalCaptionControl()) {
        return;
      }

      const roomId = this.getRoomIdFromLocation({ allowMasterLookup: true });
      if (window.electronAPI?.onPresentationPluginEvent) {
        this.localUnsubscribe = window.electronAPI.onPresentationPluginEvent(PLUGIN_NAME, (message) => {
          if (message?.type !== 'caption-state') return;
          const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
          this.applyCaptionState(payload, { source: 'local' });
          this.emitPresenterPluginEvent('caption-state', payload);
        });
      }

      window.electronAPI.presentationPluginTrigger(PLUGIN_NAME, 'start-session', { roomId })
        .then((state) => {
          if (state && typeof state === 'object') {
            this.applyCaptionState(state, { source: 'local' });
          }
          this.startHeartbeat(roomId);
        })
        .catch((err) => {
          console.error('[captions] failed to start session', err);
        });

      window.electronAPI.presentationPluginTrigger(PLUGIN_NAME, 'get-state')
        .then((state) => {
          if (state && typeof state === 'object') {
            this.applyCaptionState(state, { source: 'local' });
          }
        })
        .catch(() => {});
    },

    startHeartbeat(roomId) {
      if (!this.hasLocalCaptionControl()) {
        return;
      }
      if (this.heartbeatTimer) {
        window.clearInterval(this.heartbeatTimer);
      }
      const sendHeartbeat = () => {
        window.electronAPI.presentationPluginTrigger(PLUGIN_NAME, 'heartbeat-session', { roomId }).catch(() => {});
      };
      sendHeartbeat();
      this.heartbeatTimer = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    },

    isElectronPresenterSession() {
      return !!window.electronAPI && !this.isRemoteFollowerSession();
    },

    hasLocalCaptionControl() {
      return !!window.electronAPI?.presentationPluginTrigger;
    },

    ensureOverlay() {
      if (this.overlay && this.overlay.isConnected) return;

      const overlay = document.createElement('div');
      overlay.id = 'revelation-captions-overlay';
      overlay.setAttribute('aria-live', 'polite');
      overlay.setAttribute('aria-atomic', 'true');
      overlay.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:4.5vh',
        'transform:translateX(-50%)',
        'max-width:min(92vw,1100px)',
        'padding:0.7em 1em',
        'border-radius:0.45em',
        'background:rgba(0,0,0,0.78)',
        'color:#fff',
        'font:700 clamp(22px,2.8vw,40px)/1.25 "Source Sans Pro",system-ui,sans-serif',
        'text-align:center',
        'white-space:pre-line',
        'text-wrap:balance',
        'box-shadow:0 10px 35px rgba(0,0,0,0.28)',
        'z-index:2147483647',
        'pointer-events:none',
        'opacity:0',
        'transition:opacity 140ms ease'
      ].join(';');

      const text = document.createElement('div');
      overlay.appendChild(text);
      document.body.appendChild(overlay);

      this.overlay = overlay;
      this.overlayText = text;
      this.render();
    },

    applyCaptionState(state = {}, options = {}) {
      const source = options.source === 'local' ? 'local' : 'remote';
      const lines = Array.isArray(state.lines) ? state.lines.map(normalizeText).filter(Boolean) : [];
      const text = normalizeText(state.text || lines.join('\n'));
      this.state.text = text;
      this.state.lines = lines;
      this.state.updatedAt = Number(state.updatedAt) || Date.now();
      if (source === 'local') {
        this.state.localServiceRunning = !!state.running;
      } else {
        this.state.remoteServiceRunning = !!state.running;
        if (!this.state.visibilityTouched && (text || state.running)) {
          this.state.visibilityEnabled = true;
        }
      }
      this.render();
    },

    getPresentationMenuItems() {
      return [
        {
          label: this.state.visibilityEnabled ? 'Stop Captions' : 'Start Captions',
          action: () => {
            this.toggleCaptionService();
          }
        }
      ];
    },

    async toggleCaptionService() {
      const canControlLocal = this.hasLocalCaptionControl();
      const roomId = this.getRoomIdFromLocation({ allowMasterLookup: true });
      try {
        if (this.state.visibilityEnabled) {
          this.state.visibilityTouched = true;
          this.state.visibilityEnabled = false;
          this.render();

          if (!canControlLocal || !this.state.localServiceRunning) {
            return;
          }

          const nextState = await window.electronAPI.presentationPluginTrigger(PLUGIN_NAME, 'stop-session', { roomId });
          if (this.heartbeatTimer) {
            window.clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
          }
          if (nextState && typeof nextState === 'object') {
            this.applyCaptionState(nextState, { source: 'local' });
          }
          return;
        }

        this.state.visibilityTouched = true;
        this.state.visibilityEnabled = true;
        this.render();

        if (!canControlLocal) {
          return;
        }

        const nextState = await window.electronAPI.presentationPluginTrigger(PLUGIN_NAME, 'start-session', {
          roomId,
          forceStart: true
        });
        this.startHeartbeat(roomId);
        if (nextState && typeof nextState === 'object') {
          this.applyCaptionState(nextState, { source: 'local' });
        }
      } catch (err) {
        console.error('[captions] failed to toggle caption service', err);
      }
    },

    render() {
      this.ensureOverlay();
      const lines = this.state.lines && this.state.lines.length
        ? this.state.lines
        : (this.state.text ? this.state.text.split('\n').map(normalizeText).filter(Boolean) : []);
      const text = lines.join('\n');
      this.overlayText.textContent = text;
      this.overlay.style.opacity = this.state.visibilityEnabled && text ? '1' : '0';
    },

    getPresenterPluginSocketEndpoint() {
      const fallbackPath = SOCKET_PATH;
      const configured = String(window.presenterPluginsPublicServer || '').trim();
      if (!configured) {
        return { connectUrl: window.location.origin, socketPath: fallbackPath };
      }
      try {
        if (configured.startsWith('/')) {
          return { connectUrl: window.location.origin, socketPath: configured };
        }
        const parsed = new URL(configured, window.location.href);
        const socketPath = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : fallbackPath;
        return { connectUrl: parsed.origin, socketPath };
      } catch {
        return { connectUrl: window.location.origin, socketPath: fallbackPath };
      }
    },

    getRoomIdFromLocation(options = {}) {
      const allowMasterLookup = options.allowMasterLookup === true;
      try {
        const params = new URLSearchParams(window.location.search);
        const fromQuery = String(params.get('remoteMultiplexId') || '').trim();
        if (fromQuery) return fromQuery;
      } catch {
        // Ignore URL parsing failures.
      }

      if (allowMasterLookup) {
        return this.getMultiplexIdFromPresentationStore();
      }
      return '';
    },

    getMultiplexIdFromPresentationStore() {
      try {
        const baseUrl = window.location.href.replace(/#.*/, '');
        const canonicalBaseUrl = this.stripPeerModeParams(baseUrl);
        const raw = window.localStorage?.getItem('presentations');
        const presentations = JSON.parse(raw || '{}');
        const entry = presentations[baseUrl] || presentations[canonicalBaseUrl];
        return String(entry?.multiplexId || '').trim();
      } catch {
        return '';
      }
    },

    stripPeerModeParams(url) {
      try {
        const parsed = new URL(url);
        parsed.searchParams.delete('lang');
        parsed.searchParams.delete('variant');
        return parsed.toString();
      } catch {
        return url;
      }
    },

    isRemoteFollowerSession() {
      try {
        const params = new URLSearchParams(window.location.search);
        return params.has('remoteMultiplexId');
      } catch {
        return false;
      }
    },

    scheduleRoomLookupRetry(options = {}) {
      if (this.roomLookupRetryTimer) return;
      this.roomLookupRetryTimer = window.setTimeout(() => {
        this.roomLookupRetryTimer = null;
        this.tryConnectPresenterPluginSocket(options);
      }, 1000);
    },

    tryConnectPresenterPluginSocket(options = {}) {
      if (this.pluginSocket) return;

      const allowMasterLookup = options.allowMasterLookup === true;
      const quietIfMissing = options.quietIfMissing === true;
      const roomId = this.getRoomIdFromLocation({ allowMasterLookup });

      if (!roomId) {
        if (!quietIfMissing) {
          console.warn('[captions] no presenter room id found');
        }
        this.scheduleRoomLookupRetry(options);
        return;
      }

      if (typeof window.RevelationSocketIOClient !== 'function') {
        this.scheduleRoomLookupRetry(options);
        return;
      }

      this.pluginSocketRoomId = roomId;
      const endpoint = this.getPresenterPluginSocketEndpoint();
      const socket = window.RevelationSocketIOClient(endpoint.connectUrl, {
        path: endpoint.socketPath,
        transports: ['websocket', 'polling']
      });

      this.pluginSocket = socket;

      socket.on('connect', () => {
        this.pluginSocketConnected = true;
        this.joinPresenterPluginRoom();
      });

      socket.on('disconnect', () => {
        this.pluginSocketConnected = false;
        this.pluginSocketJoinPending = false;
      });

      socket.on('connect_error', (err) => {
        console.warn('[captions] socket connect_error', err?.message || 'unknown error');
      });

      socket.on('presenter-plugin:event', (event) => {
        if (!event || event.plugin !== PLUGIN_NAME) return;
        if (String(event.roomId || '').trim() !== this.pluginSocketRoomId) return;
        const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
        if (event.type === 'caption-state') {
          this.applyCaptionState(payload, { source: 'remote' });
          return;
        }
        if (event.type === 'caption-request-state') {
          if (!this.hasLocalCaptionControl() || !this.state.localServiceRunning) return;
          this.emitPresenterPluginEvent('caption-state', {
            text: this.state.text,
            lines: this.state.lines,
            running: this.state.localServiceRunning,
            updatedAt: this.state.updatedAt
          });
        }
      });
    },

    joinPresenterPluginRoom() {
      if (!this.pluginSocket || !this.pluginSocketConnected || !this.pluginSocketRoomId) return;
      if (this.pluginSocketJoinPending) return;
      this.pluginSocketJoinPending = true;
      this.pluginSocket.emit(
        'presenter-plugin:join',
        { plugin: PLUGIN_NAME, roomId: this.pluginSocketRoomId },
        (result = {}) => {
          this.pluginSocketJoinPending = false;
          if (!result.ok) {
            console.warn('[captions] presenter room join failed', result.error || 'unknown error');
            return;
          }
          this.emitPresenterPluginEvent('caption-request-state', {
            requester: this.hasLocalCaptionControl() ? 'electron' : 'browser',
            requestedAt: Date.now()
          });
        }
      );
    },

    emitPresenterPluginEvent(type, payload = {}) {
      if (!this.pluginSocket || !this.pluginSocketConnected || !this.pluginSocketRoomId) return;
      this.pluginSocket.emit('presenter-plugin:event', {
        type,
        payload
      });
    }
  };
})();
