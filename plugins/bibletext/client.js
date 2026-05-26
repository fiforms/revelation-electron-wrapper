(function () {
  function t(key) {
    return typeof window.tr === 'function' ? window.tr(key) : key;
  }

  // A magic "live" slide is just this single-line block on its own slide.
  const LIVE_BLOCK_RE = /^[ \t]*:bibleverse:[ \t]*$/gm;

  window.RevelationPlugins['bibletext'] = {
    name: 'bibletext',
    priority: 88,

    // Live verse follower state (deck only).
    _liveStarted: false,
    _liveRetries: 0,
    _liveSocket: null,
    _liveRoomId: '',
    _liveTick: null,
    _latest: null,

    init(ctx) {
      this.context = ctx;
      if (ctx?.baseURL) {
        window.translationsources ||= [];
        window.translationsources.push(`${ctx.baseURL}/locales/translations.json`);
        if (typeof window.loadTranslations === 'function') {
          window.loadTranslations().catch((err) => {
            console.warn('[bibletext] failed to load plugin translations:', err);
          });
        }
      }
      // Only the slide deck follows live verses; other pages (builder, lists) skip this.
      if (ctx?.page === 'presentations') {
        this._startLiveFollower();
      }
    },

    // Turn a `:bibleverse:` slide into an empty container the deck fills live, and
    // tag the <section> with data-magic-slide so these slides can be spotted in the
    // builder sorter and Reveal overview. The attribute is added here at compile time,
    // so it never has to live in the saved markdown.
    preprocessMarkdown(md) {
      return String(md ?? '').replace(
        LIVE_BLOCK_RE,
        '<!-- .slide: data-magic-slide -->\n<div class="bibletext-live" data-bibletext-live="1"></div>'
      );
    },

    getContentCreators(pres) {
      return [
        {
          label: `📖 ${t('Add Bible Passage…')+'  (Ctrl+B)'}`,
          action: ({ slug, mdFile, returnKey }) =>
            window.electronAPI.pluginTrigger('bibletext', 'open-bibletext-dialog', {
              slug: slug || pres.slug,
              mdFile: mdFile || pres.md,
              returnKey
            })
        }
      ];
    },

    // Insert a blank "magic" slide that shows whatever verse is sent live.
    getBuilderTemplates() {
      return [
        {
          label: `📖 ${t('Add Live Bible Slide')}`,
          markdown: ':bibleverse:\n'
        }
      ];
    },

    getBuilderExtensions({ host }) {
      host.registerKeyboardShortcut({
        key: 'b',
        ctrl: true,
        onTrigger() {
          host.triggerContentCreator('bibletext');
        }
      });
      return [];
    },

    // --- Live verse follower (slide deck: local projector + LAN browsers) ---

    getLiveEndpoint() {
      const configured = String(window.presenterPluginsPublicServer || '').trim();
      if (!configured || configured.startsWith('/')) return null;
      try {
        const parsed = new URL(configured, window.location.href);
        const socketPath = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
        if (!socketPath) return null;
        return { connectUrl: parsed.origin, socketPath };
      } catch {
        return null;
      }
    },

    getLiveRoomId() {
      const m = String(this.context?.baseURL || '').match(/\/plugins_([^/]+)/);
      return m ? `live-${m[1]}` : '';
    },

    ensureLiveStyles() {
      if (document.getElementById('bibletext-live-styles')) return;
      const style = document.createElement('style');
      style.id = 'bibletext-live-styles';
      style.textContent = [
        // Reserve height so the (initially empty) slide is centered as a tall block;
        // the verse then lands near the middle instead of low on the screen.
        '.bibletext-live { min-height: 30vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }',
        '.bibletext-live-verse { line-height: 1.3; }',
        '.bibletext-live-ref { display: block; margin-top: 0.25em; font-style: italic; opacity: 0.8; font-size: 0.7em; }',
        '.bibletext-live-abbr { font-size: 0.8em; }'
      ].join('\n');
      document.head.appendChild(style);
    },

    _startLiveFollower() {
      if (this._liveStarted) return;
      if (typeof window.RevelationSocketIOClient !== 'function') {
        if (this._liveRetries++ > 15) return;
        window.setTimeout(() => this._startLiveFollower(), 1000);
        return;
      }
      const endpoint = this.getLiveEndpoint();
      const roomId = this.getLiveRoomId();
      if (!endpoint || !roomId) {
        console.warn('[bibletext] live verse follower disabled: no socket endpoint or room');
        return;
      }
      this._liveStarted = true;
      this.ensureLiveStyles();

      const socket = window.RevelationSocketIOClient(endpoint.connectUrl, {
        path: endpoint.socketPath,
        transports: ['websocket', 'polling']
      });
      this._liveSocket = socket;
      this._liveRoomId = roomId;

      socket.on('connect', () => {
        socket.emit('presenter-plugin:join', { plugin: 'bibletext', roomId }, (res = {}) => {
          if (res.ok) {
            socket.emit('presenter-plugin:event', { type: 'live-verse-request', payload: {} });
          } else {
            console.warn('[bibletext] live room join failed:', res.error || 'unknown error');
          }
        });
      });

      socket.on('presenter-plugin:event', (event) => {
        if (!event || event.plugin !== 'bibletext') return;
        if (String(event.roomId || '') !== this._liveRoomId) return;
        if (event.type !== 'live-verse') return;
        const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
        this._latest = { version: Number(payload.version) || 0, html: String(payload.html || '') };
        this._renderLive();
      });

      // Cheap local reconciler: paint the latest verse into any (re)rendered magic
      // slide. No network — just keeps the DOM in sync as slides compile/change.
      this._liveTick = window.setInterval(() => this._renderLive(), 1000);
    },

    _renderLive() {
      if (!this._latest) return;
      const { version, html } = this._latest;
      const stamp = String(version);
      let changed = false;
      document.querySelectorAll('.bibletext-live').forEach((el) => {
        if (el.dataset.liveVersion === stamp) return;
        el.innerHTML = html || '';
        el.dataset.liveVersion = stamp;
        changed = true;
      });
      // Recompute Reveal's vertical centering for the new content height — this is
      // what navigating off and back onto the slide does, but without the trip.
      if (changed && typeof window.deck?.layout === 'function') {
        window.deck.layout();
      }
    }
  };
})();
