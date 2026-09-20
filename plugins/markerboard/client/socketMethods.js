export const socketMethods = {
  hasRemoteMultiplexIdInUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      return String(params.get('remoteMultiplexId') || '').trim().length > 0;
    } catch {
      return false;
    }
  },

  getPresenterPluginSocketEndpoint() {
    const configured = String(window.presenterPluginsPublicServer || '').trim();
    if (!configured) return null;

    try {
      // A relative path such as "/presenter-plugins-socket" resolves against
      // the deck's own origin — the local Vite server, correct for both the
      // presenter window and LAN browsers. Relative paths used to be rejected
      // here, which forced all traffic off-machine. See SECURITY.md (F3).
      const parsed = new URL(configured, window.location.href);
      const socketPath = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
      if (!socketPath) return null;
      return { connectUrl: parsed.origin, socketPath };
    } catch {
      return null;
    }
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
    const allowMasterLookup = options.allowMasterLookup === true;
    const quietIfMissing = options.quietIfMissing === true;
    if (this.pluginSocket) return;
    const roomId = this.getRoomIdFromLocation({ allowMasterLookup });
    if (!roomId) {
      if (!quietIfMissing) {
        this.debugSocket('socket disabled: no multiplex room id available');
      }
      return;
    }
    if (typeof window.RevelationSocketIOClient !== 'function') {
      this.debugSocket('socket client not ready yet, retrying');
      window.setTimeout(
        () => this.tryConnectPresenterPluginSocket({ allowMasterLookup, quietIfMissing }),
        500
      );
      return;
    }

    this.pluginSocketRoomId = roomId;
    const endpoint = this.getPresenterPluginSocketEndpoint();
    if (!endpoint?.connectUrl || !endpoint?.socketPath) {
      if (!quietIfMissing) {
        this.debugSocket('socket disabled: presenterPluginsPublicServer must be an absolute socket URL');
      }
      return;
    }
    const connectUrl = endpoint.connectUrl;
    const socketPath = endpoint.socketPath;
    this.debugSocket(`connecting to ${connectUrl}${socketPath} room=${roomId}`);
    const socket = window.RevelationSocketIOClient(connectUrl, {
      path: socketPath,
      transports: ['websocket', 'polling']
    });
    this.pluginSocket = socket;

    socket.on('connect', () => {
      this.pluginSocketConnected = true;
      this.debugSocket(`connected socketId=${socket.id || 'unknown'}`);
      this.joinPresenterPluginRoom();
    });

    socket.on('disconnect', () => {
      this.debugSocket('disconnected');
      this.pluginSocketConnected = false;
      this.pluginSocketJoinPending = false;
    });

    socket.on('connect_error', (err) => {
      this.debugSocket(`connect_error: ${err?.message || 'unknown error'}`);
    });

    socket.on('presenter-plugin:event', (event) => {
      if (!event || event.plugin !== 'markerboard') return;
      if (event.roomId && this.pluginSocketRoomId && event.roomId !== this.pluginSocketRoomId) return;
      this.debugSocket(`received event type=${event.type}`);
      if (event.type === 'markerboard-op') {
        const op = event.payload?.op;
        this.receiveRemoteOp(op);
        return;
      }
      if (event.type === 'markerboard-snapshot') {
        this.receiveRemoteSnapshot(event.payload);
        return;
      }
      if (event.type === 'markerboard-request-snapshot') {
        // With public mode off, presenter stays authoritative; otherwise any peer can answer
        // so refreshed clients can bootstrap from the room even without master logic.
        if (!this.state.publicMode && this.isRemoteFollowerSession()) return;
        this.broadcastFullSnapshot({ reason: 'request-snapshot', force: true });
        return;
      }
      if (event.type === 'markerboard-enabled') {
        const enabled = !!event.payload?.enabled;
        this.debugSocket(`remote enabled=${enabled}`);
        this.toggle(enabled, { broadcast: false });
      }
    });
  },

  debugSocket(message) {
    if (!this.socketDebug) return;
    console.log(`[markerboard-socket] ${message}`);
  },

  // Tears down the current presenter-plugin socket so a fresh connect can be attempted.
  disconnectPresenterPluginSocket() {
    if (this.pluginSocket) {
      try {
        this.pluginSocket.disconnect();
      } catch {
        // Ignore disconnect errors from an already-dead socket.
      }
    }
    this.pluginSocket = null;
    this.pluginSocketConnected = false;
    this.pluginSocketRoomId = '';
    this.pluginSocketJoinPending = false;
  },

  // The master session's multiplexId is written to localStorage asynchronously by
  // reveal.js-remote's own socket handshake, which can finish well after markerboard's
  // initial connect attempt. Poll for a while and reconnect/rejoin if the stored id
  // shows up late or changes, so master and followers end up in the same socket room.
  watchForMasterRoomIdChanges() {
    if (this.masterRoomWatchTimer) return;
    let attempts = 0;
    const maxAttempts = 40;
    this.masterRoomWatchTimer = window.setInterval(() => {
      attempts += 1;
      const stored = this.getMultiplexIdFromPresentationStore();
      if (stored && stored !== this.pluginSocketRoomId) {
        this.debugSocket(`master multiplexId changed old=${this.pluginSocketRoomId || 'none'} new=${stored}`);
        this.disconnectPresenterPluginSocket();
        this.tryConnectPresenterPluginSocket({ allowMasterLookup: true, quietIfMissing: true });
      }
      if (attempts >= maxAttempts) {
        window.clearInterval(this.masterRoomWatchTimer);
        this.masterRoomWatchTimer = null;
      }
    }, 500);
  },

  isRemoteFollowerSession() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.has('remoteMultiplexId');
    } catch {
      return false;
    }
  },

  joinPresenterPluginRoom() {
    if (!this.pluginSocket || !this.pluginSocketConnected || !this.pluginSocketRoomId) return;
    if (this.pluginSocketJoinPending) return;
    this.pluginSocketJoinPending = true;
    this.pluginSocket.emit(
      'presenter-plugin:join',
      { plugin: 'markerboard', roomId: this.pluginSocketRoomId },
      (result = {}) => {
        this.pluginSocketJoinPending = false;
        if (!result.ok) {
          this.debugSocket(`join failed: ${result.error || 'unknown'}`);
          return;
        }
        this.debugSocket(`joined room=${result.room || this.pluginSocketRoomId}`);
        // Poll room state on open/refresh so this client synchronizes doc + enabled state.
        this.emitPresenterPluginEvent('markerboard-request-snapshot', {
          requesterClientId: this.clientId
        });
      }
    );
  },

  emitPresenterPluginEvent(type, payload = {}) {
    if (!this.pluginSocket || !this.pluginSocketConnected || !this.pluginSocketRoomId) return;
    this.debugSocket(`emit event type=${type}`);
    this.pluginSocket.emit('presenter-plugin:event', {
      type,
      payload
    });
  },

  // Sends the full markerboard document state so peers can hard-resync.
  broadcastFullSnapshot(options = {}) {
    const force = options.force !== false;
    const reason = String(options.reason || 'unspecified');
    const snapshotTs = Date.now();
    this.lastAppliedSnapshotTs = Math.max(this.lastAppliedSnapshotTs || 0, snapshotTs);
    this.emitPresenterPluginEvent('markerboard-snapshot', {
      doc: this.doc,
      enabled: !!this.state.enabled,
      sourceClientId: this.clientId,
      snapshotTs,
      force,
      reason
    });
  },

  queueAppendForEmit(op) {
    const strokeId = String(op?.payload?.strokeId || '').trim();
    if (!strokeId || !op?.slideKey || !Array.isArray(op?.payload?.points) || op.payload.points.length === 0) {
      return;
    }
    const key = `${op.slideKey}::${strokeId}`;
    const existing = this.pendingAppendEmits.get(key);
    if (existing) {
      existing.points.push(...op.payload.points);
    } else {
      this.pendingAppendEmits.set(key, {
        slideKey: op.slideKey,
        strokeId,
        points: [...op.payload.points]
      });
    }
    this.scheduleAppendEmitFlush();
  },

  scheduleAppendEmitFlush() {
    if (this.appendEmitFlushTimer) return;
    this.appendEmitFlushTimer = window.setTimeout(() => {
      this.appendEmitFlushTimer = null;
      this.flushPendingAppendEmits();
    }, this.appendEmitBatchMs);
  },

  flushPendingAppendEmits() {
    if (this.appendEmitFlushTimer) {
      window.clearTimeout(this.appendEmitFlushTimer);
      this.appendEmitFlushTimer = null;
    }
    if (!this.pendingAppendEmits || this.pendingAppendEmits.size === 0) return;

    const batched = Array.from(this.pendingAppendEmits.values());
    this.pendingAppendEmits.clear();
    batched.forEach((entry) => {
      const op = {
        opId: this.nextOpId(),
        clientId: this.clientId,
        ts: Date.now(),
        type: 'append_points',
        slideKey: entry.slideKey,
        payload: {
          strokeId: entry.strokeId,
          points: entry.points
        }
      };
      this.emitPresenterPluginEvent('markerboard-op', { op });
    });
  },

  receiveRemoteSnapshot(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.sourceClientId && payload.sourceClientId === this.clientId) return;
    const snapshot = payload.doc && typeof payload.doc === 'object' ? payload.doc : payload;
    const remoteEnabled = typeof payload.enabled === 'boolean' ? payload.enabled : null;
    const force = payload.force === true;
    const snapshotTs = Number(payload.snapshotTs) || 0;
    if (remoteEnabled !== null && this.state.enabled !== remoteEnabled) {
      this.toggle(remoteEnabled, { broadcast: false });
    }

    if (!snapshot || typeof snapshot !== 'object') return;
    const now = Date.now();
    if (!force && now - this.lastRemoteSnapshotAt < 300) return;
    this.lastRemoteSnapshotAt = now;
    const hasLocalOps = Array.isArray(this.doc?.opLog) && this.doc.opLog.length > 0;
    const isNewerSnapshot = snapshotTs > (this.lastAppliedSnapshotTs || 0);
    if (!force && hasLocalOps && !isNewerSnapshot) return;
    try {
      this.doc = JSON.parse(JSON.stringify(snapshot));
    } catch {
      return;
    }
    this.seenOpIds = new Set();
    for (const op of this.doc.opLog || []) {
      if (op?.opId) this.seenOpIds.add(op.opId);
    }
    this.syncLocalCountersFromDoc();
    this.lastAppliedSnapshotTs = Math.max(this.lastAppliedSnapshotTs || 0, snapshotTs || now);
    this.scheduleRepaint();
  },

  receiveRemoteOp(op) {
    if (!op || typeof op !== 'object' || !op.opId) return;
    if (op.clientId === this.clientId) return;
    if (this.seenOpIds.has(op.opId)) return;
    this.seenOpIds.add(op.opId);
    this.doc.opLog.push(op);
    this.applyOp(op);
    if (op.slideKey === this.currentSlideKey()) {
      this.scheduleRepaint();
    }
  }
};
