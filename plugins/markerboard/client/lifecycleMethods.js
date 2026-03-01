export const lifecycleMethods = {
  // Entry point called by the plugin loader; seeds context/doc identity and starts deck/socket wiring.
  init(context) {
    this.context = context;
    this.state.privateMode = this.resolvePrivateModeFromConfig(context?.config);
    this.doc.docId = this.getDocId();
    console.log('[markerboard] init', context);
    if (this.state.privateMode) {
      console.log('[markerboard] private mode enabled: follower sessions are read-only');
    }
    // Auto-connect immediately for follower URLs that already carry remoteMultiplexId.
    this.tryConnectPresenterPluginSocket({ allowMasterLookup: false, quietIfMissing: true });
    this.lazyBindDeck();
  },

  // Reads private-mode setting from plugin config using tolerant bool parsing.
  resolvePrivateModeFromConfig(config) {
    const raw = config?.privateMode;
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw !== 0;
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      return (
        normalized === '1' ||
        normalized === 'true' ||
        normalized === 'yes' ||
        normalized === 'on' ||
        normalized === 'private'
      );
    }
    return false;
  },

  // Returns true if this client is allowed to author shared markerboard changes.
  canCurrentUserDraw() {
    if (!this.state.privateMode) return true;
    return !this.isRemoteFollowerSession();
  },

  // Returns true if this client can broadcast shared state toggles/events.
  canCurrentUserBroadcast() {
    return this.canCurrentUserDraw();
  },

  // Builds a stable document id from presentation identity, used for storage and exports.
  getDocId() {
    const identity = this.getPresentationIdentity();
    return `presentation:${identity.slug}:${identity.mdFile}`;
  },

  // Resolves the current presentation identity (slug + source markdown file) from URL/path.
  // This keeps saved marker snapshots tied to the presentation rather than ephemeral URL details.
  getPresentationIdentity() {
    let slug = '';
    let mdFile = 'presentation.md';

    try {
      const params = new URLSearchParams(window.location.search);
      slug = String(params.get('slug') || '').trim();
      const p = String(params.get('p') || '').trim();
      if (p) mdFile = p;
    } catch {
      // Keep defaults.
    }

    if (!slug) {
      try {
        const pathMatch = window.location.pathname.match(/\/presentations_[^/]+\/([^/]+)\//);
        slug = String(pathMatch?.[1] || '').trim();
      } catch {
        // Keep empty slug fallback below.
      }
    }

    if (!slug) slug = 'unknown-slug';
    if (!mdFile) mdFile = 'presentation.md';
    return { slug, mdFile };
  },

  // Attaches Reveal deck and window listeners exactly once so markerboard tracks slide lifecycle.
  bindDeck(deck) {
    if (!deck || this.deckEventsBound) return;
    this.deck = deck;
    this.deckEventsBound = true;

    deck.on('slidechanged', () => {
      this.ensureCoordinateSpaceFromDeck();
      this.beginTransitionFadeOut();
      this.scheduleRepaint({ includeImmediate: false, baseDelay: 90 });
    });
    deck.on('ready', () => {
      this.ensureCoordinateSpaceFromDeck();
      this.resizeCanvas();
      this.scheduleRepaint();
      this.finishTransitionFadeIn();
    });
    deck.on('slidetransitionend', () => {
      this.ensureCoordinateSpaceFromDeck();
      this.scheduleRepaint();
      this.finishTransitionFadeIn();
    });
    deck.on('overviewshown', () => {
      if (this.state.enabled) {
        this.hiddenByOverview = true;
        this.setOverlayVisibility(false);
      }
    });
    deck.on('overviewhidden', () => {
      if (this.hiddenByOverview && this.state.enabled) {
        this.setOverlayVisibility(true);
      }
      this.hiddenByOverview = false;
    });

    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.updateToolbarScale();
      this.scheduleRepaint();
    });

    // Keyboard toggle: press "M" to open/close markerboard without using the context menu.
    document.addEventListener('keydown', (event) => {
      const key = String(event.key || '');
      const isMKey = key === 'm' || key === 'M';
      if (!isMKey) return;
      if (event.repeat) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const target = event.target;
      const tagName = String(target?.tagName || '').toLowerCase();
      const isTypingField =
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        !!target?.isContentEditable ||
        !!target?.closest?.('[contenteditable=\"true\"]');
      if (isTypingField) return;

      event.preventDefault();
      this.toggle();
    });
  },

  // Cancels delayed repaint timers to avoid duplicate paints after rapid deck events.
  clearPendingRepaints() {
    for (const id of this.repaintTimerIds) {
      window.clearTimeout(id);
    }
    this.repaintTimerIds = [];
  },

  // Repaints now and on staggered delays to keep canvas in sync through transitions/layout updates.
  scheduleRepaint(options = {}) {
    const includeImmediate = options.includeImmediate !== false;
    const baseDelay = Number.isFinite(options.baseDelay) ? Number(options.baseDelay) : 0;
    this.clearPendingRepaints();
    if (includeImmediate) {
      this.renderCurrentSlide();
      window.requestAnimationFrame(() => this.renderCurrentSlide());
    }
    const delays = [40, 140, 280].map((delay) => delay + baseDelay);
    if (!includeImmediate && baseDelay > 0) {
      delays.unshift(baseDelay);
    }
    for (const delay of delays) {
      const id = window.setTimeout(() => {
        this.renderCurrentSlide();
      }, delay);
      this.repaintTimerIds.push(id);
    }
  },

  // Fades marker layer out at transition start to avoid abrupt redraw artifacts.
  beginTransitionFadeOut() {
    if (!this.canvas || !this.state.enabled || this.hiddenByOverview) return;
    if (this.transitionFadeInTimer) {
      window.clearTimeout(this.transitionFadeInTimer);
      this.transitionFadeInTimer = null;
    }
    this.canvas.style.transition = 'opacity 80ms linear';
    this.canvas.style.opacity = '0';

    if (this.transitionFadeOutTimer) {
      window.clearTimeout(this.transitionFadeOutTimer);
    }
    this.transitionFadeOutTimer = window.setTimeout(() => {
      this.transitionFadeOutTimer = null;
    }, 100);
  },

  // Fades marker layer back in after transition timing settles.
  finishTransitionFadeIn() {
    if (!this.canvas || !this.state.enabled || this.hiddenByOverview) return;
    if (this.transitionFadeOutTimer) {
      window.clearTimeout(this.transitionFadeOutTimer);
      this.transitionFadeOutTimer = null;
    }
    if (this.transitionFadeInTimer) {
      window.clearTimeout(this.transitionFadeInTimer);
    }
    this.transitionFadeInTimer = window.setTimeout(() => {
      this.canvas.style.transition = 'opacity 120ms ease-out';
      this.canvas.style.opacity = '1';
      this.transitionFadeInTimer = null;
    }, 20);
  },

  // Polls for Reveal deck availability during startup and binds when ready.
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

  // Public enable/disable control used by hotkeys, menu actions, and remote sync events.
  toggle(forceState, options = {}) {
    const nextState = typeof forceState === 'boolean' ? forceState : !this.state.enabled;
    const requestedBroadcast = options.broadcast !== false;
    const shouldBroadcast = requestedBroadcast && this.canCurrentUserBroadcast();
    const changed = nextState !== this.state.enabled;
    if (nextState && !this.pluginSocket) {
      // Master URLs usually have no remoteMultiplexId; resolve from stored presenter session only on enable.
      this.tryConnectPresenterPluginSocket({ allowMasterLookup: true, quietIfMissing: false });
    }
    this.setOverlayActive(nextState);
    if (changed && shouldBroadcast) {
      this.emitPresenterPluginEvent('markerboard-enabled', { enabled: this.state.enabled });
    }
    console.log(`[markerboard] ${this.state.enabled ? 'enabled' : 'disabled'}`);
  },

  // Contributes markerboard action(s) to the presentation context menu.
  getPresentationMenuItems(revealDeck) {
    this.bindDeck(revealDeck);
    return [
      {
        label: this.state.enabled ? 'Markerboard: Disable' : 'Markerboard: Enable',
        action: () => this.toggle()
      }
    ];
  }
};
