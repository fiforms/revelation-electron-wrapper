export const lifecycleMethods = {
  init(context) {
    this.context = context;
    this.doc.docId = this.getDocId();
    console.log('[markerboard] init', context);
    // Auto-connect immediately for follower URLs that already carry remoteMultiplexId.
    this.tryConnectPresenterPluginSocket({ allowMasterLookup: false, quietIfMissing: true });
    this.lazyBindDeck();
  },

  getDocId() {
    const identity = this.getPresentationIdentity();
    return `presentation:${identity.slug}:${identity.mdFile}`;
  },

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
      this.scheduleRepaint();
    });
  },

  clearPendingRepaints() {
    for (const id of this.repaintTimerIds) {
      window.clearTimeout(id);
    }
    this.repaintTimerIds = [];
  },

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

  toggle(forceState, options = {}) {
    const nextState = typeof forceState === 'boolean' ? forceState : !this.state.enabled;
    const shouldBroadcast = options.broadcast !== false;
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
