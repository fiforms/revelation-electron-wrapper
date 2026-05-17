/**
 * Video Stream Plugin — peer-to-peer WebRTC video sharing
 *
 * Architecture:
 * - Signaling via generic presenter-plugin:event messaging (no core changes needed)
 * - Full-mesh WebRTC (each streamer → each viewer)
 * - Single active stream at a time (no grid/PiP)
 * - User chooses webcam or screen share on start
 * - Configurable display: overlay, background, or floating
 */

function makeClientId() {
  try {
    const key = 'videostream-client-id';
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const created = `vs-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(key, created);
    return created;
  } catch {
    return `vs-${Math.random().toString(36).slice(2, 10)}`;
  }
}

window.RevelationPlugins = window.RevelationPlugins || {};
window.RevelationPlugins.videostream = {
  name: 'videostream',
  context: null,
  deck: null,
  clientId: makeClientId(),

  // Socket.io state (follows markerboard pattern)
  pluginSocket: null,
  pluginSocketConnected: false,
  pluginSocketRoomId: '',
  pluginSocketJoinPending: false,
  socketConnectRetryTimer: null,

  // Streaming state
  isStreaming: false,
  streamSource: null, // 'webcam' or 'screenshare'
  localStream: null,
  activeRemoteStreamId: null, // Only one active stream at a time

  // WebRTC peer connections (peerId → RTCPeerConnection)
  peerConnections: new Map(),
  remoteStreams: new Map(), // peerId → MediaStream

  // UI elements
  statusIndicator: null,
  videoDisplay: null,
  revealDeck: null,

  // Configuration — Display
  displayMode: 'overlay', // overlay, background, floating
  overlayPosition: 'top-right',
  overlayOpacity: 85,

  // Configuration — Video Capture
  videoWidth: 640,
  videoHeight: 480,
  videoFramerate: 24,

  // Configuration — Bitrate & Quality
  maxVideoBitrate: 2500,
  maxAudioBitrate: 64,
  degradationPreference: 'maintain-framerate', // maintain-framerate, maintain-resolution, balanced

  socketDebug: true,

  // Lifecycle
  init(context) {
    // Only initialize in presentation windows (where Reveal.js is available)
    if (typeof Reveal === 'undefined') {
      return;
    }

    this.debugLog('initializing plugin');
    this.context = context;
    this.readConfig(context?.config);
    this.tryConnectPresenterPluginSocket();
    this.buildUI();
    this.bindDeck();
    this.debugLog('plugin initialized');
  },

  readConfig(config) {
    if (!config) return;
    // Display settings
    this.displayMode = config.displayMode || 'overlay';
    this.overlayPosition = config.overlayPosition || 'top-right';
    this.overlayOpacity = config.overlayOpacity ?? 85;
    // Video capture settings
    this.videoWidth = config.videoWidth ?? 640;
    this.videoHeight = config.videoHeight ?? 480;
    this.videoFramerate = config.videoFramerate ?? 24;
    // Bitrate & quality settings
    this.maxVideoBitrate = config.maxVideoBitrate ?? 2500;
    this.maxAudioBitrate = config.maxAudioBitrate ?? 64;
    this.degradationPreference = config.degradationPreference || 'maintain-framerate';
  },

  bindDeck() {
    if (!this.deck || !Reveal) return;
    // TODO: Handle presentation slide transitions
    // - Pause stream on overview mode
    // - Clean up peer connections on unload
  },

  debugLog(msg) {
    if (!this.socketDebug) return;
    console.log(`[videostream] ${msg}`);
  },

  // ============= UI =============
  buildUI() {
    // Add styles for status indicator
    const style = document.createElement('style');
    style.textContent = `
      /* Status indicator (visible when streaming) */
      #videostream-status-indicator {
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(220, 20, 60, 0.9);
        color: white;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 12px;
        z-index: 1000;
        display: flex;
        align-items: center;
        gap: 6px;
        font-family: sans-serif;
      }
      #videostream-status-indicator.hidden {
        display: none;
      }
      #videostream-status-indicator::before {
        content: '●';
        color: #ff6b6b;
        font-size: 10px;
        animation: videostream-pulse 1s infinite;
      }
      @keyframes videostream-pulse {
        0%, 50% { opacity: 1; }
        51%, 100% { opacity: 0.3; }
      }

      /* Video display overlay modes */
      #videostream-display {
        display: none;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }
      #videostream-display.overlay-mode {
        display: block;
        position: fixed;
        width: 240px;
        height: 180px;
        z-index: 999;
      }
      #videostream-display.overlay-mode.top-left {
        top: 80px;
        left: 20px;
      }
      #videostream-display.overlay-mode.top-right {
        top: 80px;
        right: 20px;
      }
      #videostream-display.overlay-mode.bottom-left {
        bottom: 20px;
        left: 20px;
      }
      #videostream-display.overlay-mode.bottom-right {
        bottom: 20px;
        right: 20px;
      }
    `;
    document.head.appendChild(style);

    // Create status indicator (hidden until streaming)
    this.statusIndicator = document.createElement('div');
    this.statusIndicator.id = 'videostream-status-indicator';
    this.statusIndicator.className = 'hidden';
    this.statusIndicator.innerHTML = '<span>Streaming</span>';
    document.body.appendChild(this.statusIndicator);
    this.debugLog('statusIndicator created');

    // Create video display element (hidden until streaming)
    this.videoDisplay = document.createElement('video');
    this.videoDisplay.id = 'videostream-display';
    this.videoDisplay.autoplay = true;
    this.videoDisplay.playsinline = true;
    this.videoDisplay.muted = true;
    document.body.appendChild(this.videoDisplay);
    this.debugLog('videoDisplay created');
  },

  // ============= Presentation Context Menu Hook =============
  getPresentationMenuItems(revealDeck) {
    this.revealDeck = revealDeck;

    if (!this.isStreaming) {
      return [
        {
          label: '📷 Start Stream (Webcam)',
          action: () => this.startStreaming('webcam')
        },
        {
          label: '🖥️ Start Stream (Screen)',
          action: () => this.startStreaming('screenshare')
        }
      ];
    } else {
      return [
        {
          label: '⏹️ Stop Stream',
          action: () => this.handleStopStream()
        },
        {
          label: `Streaming (${this.streamSource})`,
          action: null  // disabled/info-only
        }
      ];
    }
  },

  updateStatusIndicator() {
    if (!this.statusIndicator) {
      this.debugLog('statusIndicator not initialized yet');
      return;
    }
    if (this.isStreaming) {
      this.statusIndicator.classList.remove('hidden');
    } else {
      this.statusIndicator.classList.add('hidden');
    }
  },

  // ============= Stream Control =============
  async startStreaming(source) {
    try {
      this.streamSource = source;
      this.localStream = await this.getMediaStream(source);
      this.isStreaming = true;

      // Update status indicator
      this.updateStatusIndicator();

      // Announce to peers via socket
      this.emitStreamStarted();

      this.debugLog(`Started streaming: ${source}`);
    } catch (err) {
      this.isStreaming = false;
      this.debugLog(`Failed to get media: ${err.message}`);
      console.error('[videostream] Full error:', err);
      console.error(err.stack);
      alert(`Failed to start stream: ${err.message}`);
    }
  },

  async getMediaStream(source) {
    // Check if mediaDevices API is available
    if (!navigator.mediaDevices) {
      throw new Error(
        'Media devices not available. Ensure the app is running over HTTPS or localhost, ' +
        'and that your browser supports getUserMedia/getDisplayMedia.'
      );
    }

    try {
      if (source === 'webcam') {
        return await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true
          },
          video: {
            width: { ideal: this.videoWidth },
            height: { ideal: this.videoHeight },
            frameRate: { ideal: this.videoFramerate }
          }
        });
      } else if (source === 'screenshare') {
        return await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: {
            cursor: 'always',
            frameRate: { ideal: this.videoFramerate }
          }
        });
      }
      throw new Error(`Unknown source: ${source}`);
    } catch (err) {
      // Provide user-friendly error messages
      if (err.name === 'NotAllowedError') {
        throw new Error(`Permission denied: User rejected ${source} access.`);
      } else if (err.name === 'NotFoundError') {
        throw new Error(`No ${source} device found.`);
      } else if (err.name === 'SecurityError') {
        throw new Error('Security error: HTTPS required for video streaming (or localhost for testing).');
      }
      throw err;
    }
  },

  handleStopStream() {
    this.stopStreaming();
  },

  stopStreaming() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Close all peer connections
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    this.remoteStreams.clear();

    this.isStreaming = false;
    this.streamSource = null;

    // Update status indicator
    this.updateStatusIndicator();
    this.videoDisplay.style.display = 'none';

    // Announce to peers
    this.emitStreamStopped();

    this.debugLog('Stopped streaming');
  },

  // ============= Socket Signaling (using generic presenter-plugin:event messaging) =============

  tryConnectPresenterPluginSocket() {
    if (this.pluginSocket) return;

    // Try to get room ID (with fallback to stored value in localStorage)
    const roomId = this.getRoomIdFromLocation({ allowMasterLookup: true });
    if (!roomId) {
      // Room ID not available yet, retry in 500ms
      if (this.socketConnectRetryTimer) clearTimeout(this.socketConnectRetryTimer);
      this.socketConnectRetryTimer = window.setTimeout(() => {
        this.socketConnectRetryTimer = null;
        this.tryConnectPresenterPluginSocket();
      }, 500);
      return;
    }

    if (typeof window.RevelationSocketIOClient !== 'function') {
      this.debugLog('socket client not ready yet, retrying');
      if (this.socketConnectRetryTimer) clearTimeout(this.socketConnectRetryTimer);
      this.socketConnectRetryTimer = window.setTimeout(() => {
        this.socketConnectRetryTimer = null;
        this.tryConnectPresenterPluginSocket();
      }, 500);
      return;
    }

    this.pluginSocketRoomId = roomId;
    const endpoint = this.getPresenterPluginSocketEndpoint();
    if (!endpoint?.connectUrl || !endpoint?.socketPath) {
      this.debugLog('socket disabled: presenterPluginsPublicServer must be an absolute socket URL');
      return;
    }

    const connectUrl = endpoint.connectUrl;
    const socketPath = endpoint.socketPath;
    this.debugLog(`connecting to ${connectUrl}${socketPath} room=${roomId}`);
    const socket = window.RevelationSocketIOClient(connectUrl, {
      path: socketPath,
      transports: ['websocket', 'polling']
    });
    this.pluginSocket = socket;

    socket.on('connect', () => {
      this.pluginSocketConnected = true;
      this.debugLog(`connected socketId=${socket.id || 'unknown'}`);
      this.joinPresenterPluginRoom();
    });

    socket.on('disconnect', () => {
      this.debugLog('disconnected');
      this.pluginSocketConnected = false;
      this.pluginSocketJoinPending = false;
    });

    socket.on('connect_error', (err) => {
      this.debugLog(`connect_error: ${err?.message || 'unknown error'}`);
    });

    // Listen for generic presenter-plugin events
    socket.on('presenter-plugin:event', (event) => {
      if (!event || event.plugin !== 'videostream') return;
      if (event.roomId && this.pluginSocketRoomId && event.roomId !== this.pluginSocketRoomId) return;
      this.debugLog(`received event type=${event.type}`);

      if (event.type === 'stream-started') {
        this.handleStreamStartedNotification(event.payload);
      } else if (event.type === 'stream-stopped') {
        this.handleStreamStoppedNotification(event.payload);
      } else if (event.type === 'offer') {
        this.handleRemoteOffer(event.payload);
      } else if (event.type === 'answer') {
        this.handleRemoteAnswer(event.payload);
      } else if (event.type === 'ice-candidate') {
        this.handleIceCandidate(event.payload);
      }
    });
  },

  getPresenterPluginSocketEndpoint() {
    const configured = String(window.presenterPluginsPublicServer || '').trim();
    if (!configured) return null;
    try {
      if (configured.startsWith('/')) return null;
      const parsed = new URL(configured, window.location.href);
      const socketPath = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
      if (!socketPath) return null;
      return { connectUrl: parsed.origin, socketPath };
    } catch {
      return null;
    }
  },

  getRoomIdFromLocation() {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = String(params.get('remoteMultiplexId') || '').trim();
      if (fromQuery) return fromQuery;
    } catch {
      // Ignore URL parsing errors
    }
    return '';
  },

  joinPresenterPluginRoom() {
    if (!this.pluginSocket || !this.pluginSocketConnected || !this.pluginSocketRoomId) return;
    if (this.pluginSocketJoinPending) return;
    this.pluginSocketJoinPending = true;
    this.pluginSocket.emit(
      'presenter-plugin:join',
      { plugin: 'videostream', roomId: this.pluginSocketRoomId },
      (result = {}) => {
        this.pluginSocketJoinPending = false;
        if (!result.ok) {
          this.debugLog(`join failed: ${result.error || 'unknown'}`);
          return;
        }
        this.debugLog(`joined room=${result.room || this.pluginSocketRoomId}`);
      }
    );
  },

  emitPresenterPluginEvent(type, payload = {}) {
    if (!this.pluginSocket || !this.pluginSocketConnected || !this.pluginSocketRoomId) return;
    this.debugLog(`emit event type=${type}`);
    this.pluginSocket.emit('presenter-plugin:event', {
      type,
      payload
    });
  },

  emitStreamStarted() {
    this.emitPresenterPluginEvent('stream-started', {
      clientId: this.clientId,
      source: this.streamSource
    });
  },

  emitStreamStopped() {
    this.emitPresenterPluginEvent('stream-stopped', {
      clientId: this.clientId
    });
  },

  // ============= WebRTC Signaling =============

  async handleStreamStartedNotification(data) {
    const { clientId, source } = data;
    if (clientId === this.clientId) return; // Ignore our own

    this.debugLog(`Peer ${clientId} started streaming (${source})`);

    // Create peer connection and send offer to the streamer
    const pc = this.createPeerConnection(clientId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.emitPresenterPluginEvent('offer', {
      offer: pc.localDescription,
      offererId: this.clientId,
      answererClientId: clientId
    });
  },

  async handleStreamStoppedNotification(data) {
    const { clientId } = data;
    if (clientId === this.clientId) return;

    this.debugLog(`Peer ${clientId} stopped streaming`);

    // Close peer connection
    const pc = this.peerConnections.get(clientId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(clientId);
    }

    this.remoteStreams.delete(clientId);

    // Clear video display if it was from this peer
    if (this.activeRemoteStreamId === clientId) {
      this.activeRemoteStreamId = null;
      this.videoDisplay.srcObject = null;
      this.videoDisplay.style.display = 'none';
    }
  },

  async handleRemoteOffer(data) {
    const { offer, offererId } = data;
    if (offererId === this.clientId) return;

    try {
      let pc = this.peerConnections.get(offererId);
      if (!pc) {
        pc = this.createPeerConnection(offererId);
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.emitPresenterPluginEvent('answer', {
        answer: pc.localDescription,
        answererId: this.clientId,
        offererId
      });
    } catch (err) {
      this.debugLog(`Error handling offer: ${err.message}`);
    }
  },

  async handleRemoteAnswer(data) {
    const { answer, answererId } = data;
    try {
      const pc = this.peerConnections.get(answererId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    } catch (err) {
      this.debugLog(`Error handling answer: ${err.message}`);
    }
  },

  async handleIceCandidate(data) {
    const { candidate, from } = data;
    try {
      const pc = this.peerConnections.get(from);
      if (pc && candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (err) {
      this.debugLog(`Error adding ICE candidate: ${err.message}`);
    }
  },

  createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // Add local stream tracks if we're streaming
    if (this.isStreaming && this.localStream) {
      this.localStream.getTracks().forEach(track => {
        const sender = pc.addTrack(track, this.localStream);
        // Apply bitrate constraints based on track kind
        this.applyBitrateConstraints(sender, track.kind);
      });
    }

    // Handle incoming tracks
    pc.ontrack = (event) => {
      this.debugLog(`Received remote track from ${peerId}`);
      const remoteStream = event.streams[0];
      this.remoteStreams.set(peerId, remoteStream);

      // Display the remote stream (single active stream model)
      if (!this.activeRemoteStreamId) {
        this.activeRemoteStreamId = peerId;
        this.displayRemoteStream(remoteStream);
      }
    };

    // Send ICE candidates via generic messaging
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.emitPresenterPluginEvent('ice-candidate', {
          candidate: event.candidate,
          from: this.clientId,
          to: peerId
        });
      }
    };

    this.peerConnections.set(peerId, pc);
    return pc;
  },

  async applyBitrateConstraints(sender, trackKind) {
    try {
      const params = sender.getParameters();
      if (!params.encodings) params.encodings = [{}];

      if (trackKind === 'video') {
        // Convert kbps to bps
        const maxBitrate = this.maxVideoBitrate * 1000;
        params.encodings.forEach(encoding => {
          encoding.maxBitrate = maxBitrate;
          // Set degradation preference to control quality/framerate tradeoff
          encoding.degradationPreference = this.degradationPreference;
        });
        this.debugLog(`Applied video bitrate: ${this.maxVideoBitrate} kbps, degradation: ${this.degradationPreference}`);
      } else if (trackKind === 'audio') {
        // Convert kbps to bps
        const maxBitrate = this.maxAudioBitrate * 1000;
        params.encodings.forEach(encoding => {
          encoding.maxBitrate = maxBitrate;
        });
        this.debugLog(`Applied audio bitrate: ${this.maxAudioBitrate} kbps`);
      }

      await sender.setParameters(params);
    } catch (err) {
      this.debugLog(`Failed to apply bitrate constraints: ${err.message}`);
    }
  },

  displayRemoteStream(stream) {
    if (!this.videoDisplay) {
      this.debugLog('videoDisplay not initialized yet');
      return;
    }

    this.videoDisplay.srcObject = stream;
    this.videoDisplay.className = `${this.displayMode}-mode ${this.overlayPosition}`;
    this.videoDisplay.style.opacity = `${this.overlayOpacity / 100}`;

    if (this.displayMode === 'background') {
      // Position behind slides
      this.videoDisplay.style.position = 'fixed';
      this.videoDisplay.style.top = '0';
      this.videoDisplay.style.left = '0';
      this.videoDisplay.style.width = '100%';
      this.videoDisplay.style.height = '100%';
      this.videoDisplay.style.zIndex = '0';
      this.videoDisplay.style.objectFit = 'cover';
    } else if (this.displayMode === 'overlay') {
      this.videoDisplay.style.display = 'block';
    } else if (this.displayMode === 'floating') {
      // Floating window with drag support (TODO)
      this.videoDisplay.style.display = 'block';
    }
  }
};

// Register plugin
window.RevelationPlugins.videostream.init(window.RevelationPluginContext);
