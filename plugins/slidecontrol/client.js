(function () {
  const PLUGIN_NAME = 'slidecontrol';
  const SOCKET_PATH = '/presenter-plugins-socket';

  function makeClientId() {
    try {
      const key = 'slidecontrol-client-id';
      const existing = window.localStorage.getItem(key);
      if (existing) return existing;
      const created = `sc-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(key, created);
      return created;
    } catch {
      return `sc-${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  window.RevelationPlugins = window.RevelationPlugins || {};
  window.RevelationPlugins[PLUGIN_NAME] = {
    name: PLUGIN_NAME,
    context: null,
    deck: null,
    deckEventsBound: false,
    presentationClickBound: false,
    overlayRoot: null,
    controlsBarEl: null,
    statusLabelEl: null,
    pluginSocket: null,
    pluginSocketConnected: false,
    pluginSocketRoomId: '',
    pluginSocketJoinPending: false,
    roomLookupRetryTimer: null,
    roomLookupRetryAttempts: 0,
    pendingCommands: [],
    lastConnectError: '',
    controlsVisible: false,
    allowControlFromAnyClient: true,
    disabledForReadOnlyPeer: false,
    socketDebug: true,
    socketPath: SOCKET_PATH,
    clientId: makeClientId(),

    init(context) {
      this.context = context;
      this.allowControlFromAnyClient = this.readAllowControlFromAnyClient(context?.config);
      this.disabledForReadOnlyPeer = !this.allowControlFromAnyClient && this.isRemoteFollowerSession();
      if (this.disabledForReadOnlyPeer) return;
      if (this.allowControlFromAnyClient) {
        this.tryConnectPresenterPluginSocket({ allowMasterLookup: true, quietIfMissing: true });
      }
      this.lazyBindDeck();
    },

    readAllowControlFromAnyClient(config) {
      const raw = config?.allowControlFromAnyClient;
      if (typeof raw === 'boolean') return raw;
      if (typeof raw === 'number') return raw !== 0;
      if (typeof raw === 'string') {
        const normalized = raw.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
      }
      return true;
    },

    debugSocket(message) {
      if (!this.socketDebug) return;
      console.log(`[slidecontrol-socket] ${message}`);
    },

    isRemoteFollowerSession() {
      try {
        const params = new URLSearchParams(window.location.search);
        return params.has('remoteMultiplexId');
      } catch {
        return false;
      }
    },

    canExecuteRemoteCommands() {
      return !this.isRemoteFollowerSession();
    },

    getRoomIdFromLocation(options = {}) {
      const allowMasterLookup = options.allowMasterLookup === true;
      try {
        const params = new URLSearchParams(window.location.search);
        const fromQuery = String(params.get('remoteMultiplexId') || '').trim();
        if (fromQuery) return fromQuery;
      } catch {
        // Ignore URL parsing errors.
      }

      if (allowMasterLookup) {
        const stored = this.getMultiplexIdFromPresentationStore();
        if (stored) return stored;
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
        const multiplexId = String(entry?.multiplexId || '').trim();
        return multiplexId || '';
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

    tryConnectPresenterPluginSocket(options = {}) {
      if (!this.allowControlFromAnyClient) return;
      const allowMasterLookup = options.allowMasterLookup === true;
      const quietIfMissing = options.quietIfMissing === true;
      if (this.pluginSocket) return;
      const roomId = this.getRoomIdFromLocation({ allowMasterLookup });
      if (!roomId) {
        if (!quietIfMissing) {
          this.debugSocket('socket disabled: no multiplex room id available');
        }
        this.scheduleRoomLookupRetry({ allowMasterLookup, quietIfMissing });
        this.updateStatusLabel();
        return;
      }
      this.clearRoomLookupRetry();
      if (typeof window.RevelationSocketIOClient !== 'function') {
        this.debugSocket('socket client not ready yet, retrying');
        window.setTimeout(
          () => this.tryConnectPresenterPluginSocket({ allowMasterLookup, quietIfMissing }),
          500
        );
        return;
      }

      this.pluginSocketRoomId = roomId;
      const connectUrl = window.location.origin;
      this.debugSocket(`connecting to ${connectUrl}${this.socketPath} room=${roomId}`);
      const socket = window.RevelationSocketIOClient(connectUrl, {
        path: this.socketPath,
        transports: ['websocket', 'polling']
      });
      this.pluginSocket = socket;

      socket.on('connect', () => {
        this.pluginSocketConnected = true;
        this.lastConnectError = '';
        this.debugSocket(`connected socketId=${socket.id || 'unknown'}`);
        this.joinPresenterPluginRoom();
        this.updateStatusLabel();
      });

      socket.on('disconnect', () => {
        this.debugSocket('disconnected');
        this.pluginSocketConnected = false;
        this.pluginSocketJoinPending = false;
        this.lastConnectError = '';
        this.updateStatusLabel();
      });

      socket.on('connect_error', (err) => {
        this.lastConnectError = String(err?.message || 'Connection error');
        this.debugSocket(`connect_error: ${this.lastConnectError}`);
        this.updateStatusLabel();
      });

      socket.on('presenter-plugin:event', (event) => {
        if (!event || event.plugin !== PLUGIN_NAME) return;
        if (event.type !== 'slideshow-control-command') return;
        if (!this.canExecuteRemoteCommands()) return;
        const command = String(event.payload?.command || '').trim();
        this.executeCommand(command);
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
            this.debugSocket(`join failed: ${result.error || 'unknown'}`);
            return;
          }
          this.debugSocket(`joined room=${result.room || this.pluginSocketRoomId}`);
          this.flushPendingCommands();
        }
      );
    },

    emitPresenterPluginEvent(type, payload = {}) {
      if (!this.pluginSocket || !this.pluginSocketConnected || !this.pluginSocketRoomId) return false;
      this.pluginSocket.emit('presenter-plugin:event', {
        type,
        payload
      });
      return true;
    },

    scheduleRoomLookupRetry(options = {}) {
      if (!this.allowControlFromAnyClient) return;
      if (!options.allowMasterLookup) return;
      if (this.roomLookupRetryTimer) return;
      const maxAttempts = 90;
      if (this.roomLookupRetryAttempts >= maxAttempts) return;
      this.roomLookupRetryTimer = window.setTimeout(() => {
        this.roomLookupRetryTimer = null;
        this.roomLookupRetryAttempts += 1;
        this.tryConnectPresenterPluginSocket(options);
      }, 1000);
    },

    clearRoomLookupRetry() {
      if (!this.roomLookupRetryTimer) return;
      window.clearTimeout(this.roomLookupRetryTimer);
      this.roomLookupRetryTimer = null;
    },

    lazyBindDeck() {
      let attempts = 0;
      const maxAttempts = 120;
      const timer = window.setInterval(() => {
        attempts += 1;
        if (window.deck) {
          this.bindDeck(window.deck);
          window.clearInterval(timer);
          return;
        }
        if (attempts >= maxAttempts) {
          window.clearInterval(timer);
        }
      }, 250);
    },

    bindDeck(deck) {
      if (!deck || this.deckEventsBound) return;
      this.deck = deck;
      this.deckEventsBound = true;
      this.ensureUI();
      this.bindPresentationClickToggle();
      this.updateStatusLabel();

      deck.on('ready', () => {
        if (this.allowControlFromAnyClient) {
          this.tryConnectPresenterPluginSocket({ allowMasterLookup: true, quietIfMissing: true });
        }
        this.updateStatusLabel();
      });
    },

    updateStatusLabel() {
      if (!this.statusLabelEl) return;
      const shouldShow =
        this.allowControlFromAnyClient &&
        !this.canExecuteRemoteCommands() &&
        !!this.lastConnectError;
      this.statusLabelEl.style.display = shouldShow ? 'block' : 'none';
      this.statusLabelEl.textContent = shouldShow ? `Connection error: ${this.lastConnectError}` : '';
    },

    bindPresentationClickToggle() {
      if (this.presentationClickBound) return;
      this.presentationClickBound = true;
      document.addEventListener(
        'click',
        (event) => {
          const target = event.target;
          if (!target || !target.closest) return;
          if (target.closest('#slidecontrol-overlay-root')) return;
          if (!target.closest('.reveal')) return;
          this.setControlsVisible(!this.controlsVisible);
        },
        true
      );
    },

    setControlsVisible(visible) {
      this.controlsVisible = !!visible;
      if (!this.controlsBarEl) return;
      this.controlsBarEl.style.display = this.controlsVisible ? 'flex' : 'none';
    },

    ensureUI() {
      if (this.overlayRoot) return;

      const root = document.createElement('div');
      root.id = 'slidecontrol-overlay-root';
      root.style.position = 'fixed';
      root.style.left = '50%';
      root.style.bottom = '14px';
      root.style.transform = 'translateX(-50%)';
      root.style.zIndex = '16000';
      root.style.display = 'flex';
      root.style.flexDirection = 'column';
      root.style.alignItems = 'center';
      root.style.gap = '6px';
      root.style.pointerEvents = 'none';

      const bar = document.createElement('div');
      bar.style.display = 'flex';
      bar.style.alignItems = 'center';
      bar.style.gap = '12px';
      bar.style.padding = '12px 15px';
      bar.style.borderRadius = '999px';
      bar.style.background = 'rgba(8,12,20,0.74)';
      bar.style.border = '1px solid rgba(255,255,255,0.18)';
      bar.style.backdropFilter = 'blur(5px)';
      bar.style.boxShadow = '0 10px 24px rgba(0,0,0,0.36)';
      bar.style.pointerEvents = 'auto';

      const makeButton = (label, title, command) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.title = title;
        button.style.width = '63px';
        button.style.height = '54px';
        button.style.borderRadius = '15px';
        button.style.border = '1px solid rgba(255,255,255,0.22)';
        button.style.background = 'rgba(255,255,255,0.08)';
        button.style.color = '#fff';
        button.style.font = '600 24px/1 sans-serif';
        button.style.cursor = 'pointer';
        button.style.padding = '0';
        button.style.transition = 'transform 100ms ease, background-color 100ms ease';
        button.addEventListener('mouseenter', () => {
          button.style.background = 'rgba(255,255,255,0.16)';
        });
        button.addEventListener('mouseleave', () => {
          button.style.background = 'rgba(255,255,255,0.08)';
          button.style.transform = 'scale(1)';
        });
        button.addEventListener('mousedown', () => {
          button.style.transform = 'scale(0.96)';
        });
        button.addEventListener('mouseup', () => {
          button.style.transform = 'scale(1)';
        });
        button.addEventListener('click', (event) => {
          event.preventDefault();
          this.sendCommand(command);
        });
        return button;
      };

      bar.appendChild(makeButton('<<', 'Column left', 'column_left'));
      bar.appendChild(makeButton('^', 'Previous slide', 'prev'));
      bar.appendChild(makeButton('v', 'Next slide', 'next'));
      bar.appendChild(makeButton('>>', 'Column right', 'column_right'));
      bar.appendChild(makeButton('OV', 'Toggle overview', 'overview'));
      bar.appendChild(makeButton('BL', 'Blank screen', 'blank'));

      const statusLabel = document.createElement('div');
      statusLabel.style.display = 'none';
      statusLabel.style.font = '600 11px/1.1 sans-serif';
      statusLabel.style.letterSpacing = '0.03em';
      statusLabel.style.color = 'rgba(255,205,205,0.95)';
      statusLabel.style.textShadow = '0 1px 2px rgba(0,0,0,0.45)';
      statusLabel.style.pointerEvents = 'none';

      root.appendChild(bar);
      root.appendChild(statusLabel);
      document.body.appendChild(root);

      this.overlayRoot = root;
      this.controlsBarEl = bar;
      this.statusLabelEl = statusLabel;
      this.setControlsVisible(false);
      this.updateStatusLabel();
    },

    sendCommand(command) {
      if (!command) return;
      if (this.disabledForReadOnlyPeer) return;
      if (this.canExecuteRemoteCommands()) {
        this.executeCommand(command);
        return;
      }
      if (!this.allowControlFromAnyClient) return;
      if (!this.pluginSocket) {
        this.tryConnectPresenterPluginSocket({ allowMasterLookup: true, quietIfMissing: false });
      }
      this.queueCommand(command);
      this.flushPendingCommands();
    },

    queueCommand(command) {
      const payload = {
        command,
        requesterClientId: this.clientId,
        requestedAt: Date.now()
      };
      this.pendingCommands.push(payload);
      if (this.pendingCommands.length > 30) {
        this.pendingCommands.shift();
      }
    },

    flushPendingCommands() {
      if (!Array.isArray(this.pendingCommands) || this.pendingCommands.length === 0) return;
      while (this.pendingCommands.length > 0) {
        const payload = this.pendingCommands[0];
        const sent = this.emitPresenterPluginEvent('slideshow-control-command', payload);
        if (!sent) return;
        this.pendingCommands.shift();
      }
    },

    executeCommand(command) {
      if (!this.deck) return;
      if (command === 'prev') {
        this.deck.prev?.();
        return;
      }
      if (command === 'next') {
        this.deck.next?.();
        return;
      }
      if (command === 'column_left') {
        this.deck.left?.();
        return;
      }
      if (command === 'column_right') {
        this.deck.right?.();
        return;
      }
      if (command === 'overview') {
        this.deck.toggleOverview?.();
        return;
      }
      if (command === 'blank') {
        if (typeof this.deck.togglePause === 'function') {
          this.deck.togglePause();
          return;
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
      }
    }
  };
})();
