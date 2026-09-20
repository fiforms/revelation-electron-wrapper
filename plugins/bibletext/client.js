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
          id: 'add-bible-passage',
          label: `📖 ${t('Add Bible Passage…')+'  (Ctrl+T)'}`,
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
        key: 't',
        ctrl: true,
        onTrigger() {
          host.triggerContentCreator('bibletext', 'add-bible-passage');
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
        '.bibletext-live { display: flex; flex-direction: column; align-items: center; justify-content: center; }',
        '.bibletext-live-verse { line-height: 1.3; }',
        '.bibletext-live-ref { display: block; margin-top: 0.25em; font-style: italic; opacity: 0.8; font-size: 0.7em; }',
        '.bibletext-live-abbr { font-size: 0.8em; }',
        // Lower-thirds variant (?variant=lowerthirds): pin the verse as a full-bleed
        // dark band across the bottom of the screen. Everything is scoped to this
        // container (and its children) so no other slide or element is touched.
        '.bibletext-live.is-lowerthirds .bibletext-live-container {',
        '  position: fixed; left: -50vw; right: -50vw; bottom: -50vh; width: auto;',
        '  background: #2b2b2b; padding: 0.4em 51vw calc(50vh + 0.10em);',
        '  box-sizing: border-box; font-size: 0.675em;',
        '}',
        '.bibletext-live.is-lowerthirds .bibletext-live-container,',
        '.bibletext-live.is-lowerthirds .bibletext-live-container * {',
        '  color: #f0f0f0 !important; -webkit-text-stroke: 0 !important; text-shadow: none !important;',
        '}'
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
        // Sanitize once here rather than in _renderLive(): this is the only
        // writer of _latest, so the invariant is that _latest.html is already
        // safe, and the 1s reconciler does not re-pay the cost.
        this._latest = {
          version: Number(payload.version) || 0,
          html: this._sanitizeLiveHtml(payload.html)
        };
        this._renderLive();
      });

      // Cheap local reconciler: paint the latest verse into any (re)rendered magic
      // slide. No network — just keeps the DOM in sync as slides compile/change.
      this._liveTick = window.setInterval(() => this._renderLive(), 1000);
    },

    _isLowerThirds() {
      try {
        return new URLSearchParams(window.location.search).get('variant') === 'lowerthirds';
      } catch {
        return false;
      }
    },

    // --- Live verse sanitization -------------------------------------------
    //
    // `live-verse` markup arrives over the shared presenter-plugins socket,
    // which has no authentication: room membership is the only gate and the
    // room id is derived from the install key, which is in every shared
    // presentation link. So this HTML is untrusted input and must never reach
    // innerHTML as-is. See revelation/SECURITY.md (F3).
    //
    // buildLiveVerseHtml() in ../plugin.js emits an exactly known vocabulary —
    // div/p/span/em/br carrying only `bibletext-live*` class names — so this is
    // an allowlist rather than the general markdown sanitizer. That is stricter
    // than sanitizeRenderedHTML(): it also rejects markup the general sanitizer
    // deliberately permits, such as <img>, <iframe>, and the inline `style`
    // that would let an injected element cover the projected screen.
    //
    // ⚠ If buildLiveVerseHtml() ever emits a new tag or class, add it here or
    // the new markup will be silently flattened to text.

    _LIVE_ALLOWED_TAGS: new Set(['div', 'p', 'span', 'em', 'strong', 'i', 'b', 'br']),
    // Elements whose text content must not be surfaced when the element itself
    // is rejected — unwrapping these would paint script/style source onto the
    // slide. Everything else outside the allowlist is unwrapped so that a
    // future formatting change degrades to readable text, not a blank slide.
    _LIVE_DROP_SUBTREE: new Set([
      'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'math'
    ]),

    _sanitizeLiveHtml(html) {
      const source = String(html || '');
      if (!source) return '';
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        return '';
      }

      // Parse inertly: <template> content is never fetched, executed, or run
      // through resource loading, so nothing happens during parsing itself.
      const template = document.createElement('template');
      template.innerHTML = source;

      const clean = (node) => {
        const out = document.createDocumentFragment();
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === 3) {
            out.appendChild(document.createTextNode(child.nodeValue));
            continue;
          }
          if (child.nodeType !== 1) continue; // drop comments, CDATA, PIs

          const tag = String(child.tagName || '').toLowerCase();
          if (this._LIVE_DROP_SUBTREE.has(tag)) continue;

          if (!this._LIVE_ALLOWED_TAGS.has(tag)) {
            out.appendChild(clean(child)); // unwrap: keep the text, drop the element
            continue;
          }

          const el = document.createElement(tag);
          // `class` is the only attribute carried over, and only the plugin's
          // own namespace — otherwise injected markup could borrow arbitrary
          // theme classes to restyle the slide.
          const classes = String(child.getAttribute('class') || '')
            .split(/\s+/)
            .filter((name) => /^bibletext-live[a-z0-9_-]*$/.test(name));
          if (classes.length) el.setAttribute('class', classes.join(' '));

          if (tag !== 'br') el.appendChild(clean(child));
          out.appendChild(el);
        }
        return out;
      };

      const holder = document.createElement('div');
      holder.appendChild(clean(template.content));
      return holder.innerHTML;
    },

    _renderLive() {
      if (!this._latest) return;
      const { version, html } = this._latest;
      const stamp = String(version);
      const lowerThirds = this._isLowerThirds();
      let changed = false;
      document.querySelectorAll('.bibletext-live').forEach((el) => {
        el.classList.toggle('is-lowerthirds', lowerThirds);
        if (el.dataset.liveVersion === stamp) return;
        // `html` is already allowlist-sanitized by _sanitizeLiveHtml() at the
        // point of receipt — the only writer of _latest.
        el.innerHTML = html ? `<div class="bibletext-live-container">${html}</div>` : '';
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
