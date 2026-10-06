// plugins/widgets/client.js
//
// Overlay widgets: a `:widget:` markdown block places a small live program
// (clock, calendar, weather …) on top of a slide.
//
//   :widget:
//     name: calendar
//     position: { x: 0.03, y: 0.04 }   # ratios of the slide width / height
//     size:     { w: 0.94, h: 0.90 }
//     location: { name: "Concord, NC", latitude: 35.3762, longitude: -80.541 }  # optional
//     parameters:
//       ics: "https://calendar.google.com/calendar/ical/…/public/basic.ics"
//       mode: month
//
// The widget format is documented in overlaywidgets/README.md. This file is
// the browser half of the host; endpoint-server.js is the main-process half.

(function () {
  const PLUGIN_NAME = 'widgets';
  const PRELOAD_AHEAD = 1; // slides after the current one whose widgets are painted early
  const READY_TIMEOUT_MS = 8000; // show a widget anyway if it never calls api.ready()
  const REF_W = 1920; // the coordinate space widgets are drawn in
  const REF_H = 1080;
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

  const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
  const ratio = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  // Optional `location:` on the block becomes api.location (a fixed place for
  // this placement, used by widgets such as weather when their ZIP is blank).
  function cleanLocation(loc) {
    if (!loc || typeof loc !== 'object') return null;
    const latitude = Number(loc.latitude);
    const longitude = Number(loc.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
    return { name: String(loc.name || '').slice(0, 100), latitude, longitude, source: 'slide' };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  function createStorage(prefix) {
    return {
      get(key) {
        try {
          const raw = localStorage.getItem(prefix + key);
          return raw === null ? null : JSON.parse(raw);
        } catch { return null; }
      },
      set(key, value) {
        try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch { /* unavailable */ }
      },
      remove(key) {
        try { localStorage.removeItem(prefix + key); } catch { /* unavailable */ }
      }
    };
  }

  function fetchError(reason, status) {
    const err = new Error(`Widget data unavailable: ${reason}`);
    err.reason = reason;
    if (status) err.status = status;
    return err;
  }

  // Finds the main-process bridge. The Electron preload exposes `electronAPI` on the top frame only, so:
  //  - a presentation window, or the deck inside picture-in-picture, gets presentationPluginTrigger from the
  //    shared locator (revelation/js/electron-api.js);
  //  - the builder preview is an iframe of the admin window, which exposes pluginTrigger instead. The locator
  //    deliberately does not return that larger API, so it is read here.
  // A cross-origin parent (an external page in PiP) cannot be read: the access throws and is ignored.
  function findBridge() {
    const api = window.RevelationElectronAPI?.getElectronAPI();
    if (api?.presentationPluginTrigger) {
      return (req) => api.presentationPluginTrigger(PLUGIN_NAME, 'fetch', req);
    }
    try {
      const parentApi = (window.parent && window.parent !== window) ? window.parent.electronAPI : null;
      if (parentApi?.pluginTrigger) {
        return (req) => parentApi.pluginTrigger(PLUGIN_NAME, 'fetch', req);
      }
    } catch { /* cross-origin parent */ }
    return null;
  }

  window.RevelationPlugins = window.RevelationPlugins || {};
  window.RevelationPlugins[PLUGIN_NAME] = {
    name: PLUGIN_NAME,
    baseURL: '',
    config: {},
    validate: null,
    manifests: new Map(),
    active: new Map(), // placeholder element -> { dispose }
    ready: null,
    counter: 0,

    // Synchronous markdown pre-processor: replace :widget: blocks with placeholders.
    preprocessMarkdown(md, context) {
      const parseYAML = context && typeof context.parseYAML === 'function' ? context.parseYAML : null;
      const forHandout = context && context.forHandout;

      return md.replace(/^:widget:[ \t]*\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$)|[ \t]*\r?\n)+)/gm, (match, block) => {
        if (forHandout) return '';
        if (!parseYAML) return '';

        let config;
        try {
          const lines = block.split('\n');
          const indents = lines.filter(l => l.trim()).map(l => l.match(/^[ \t]*/)[0].length);
          const min = indents.length ? Math.min(...indents) : 0;
          config = parseYAML(lines.map(l => l.slice(min)).join('\n'));
        } catch {
          return '';
        }
        if (!config || typeof config !== 'object') return '';

        const name = String(config.name || '').trim();
        if (!ID_RE.test(name)) return '';

        const payload = {
          name,
          x: ratio(config.position?.x, 0),
          y: ratio(config.position?.y, 0),
          w: ratio(config.size?.w, NaN),
          h: ratio(config.size?.h, NaN),
          location: cleanLocation(config.location),
          parameters: config.parameters && typeof config.parameters === 'object' ? config.parameters : {}
        };
        // Percent-encoded so nothing in the YAML can break out of the attribute.
        const encoded = encodeURIComponent(JSON.stringify(payload));
        return `<div class="ow-widget" data-ow="${encoded}"></div>\n\n`;
      });
    },

    init(context) {
      this.baseURL = String((context && context.baseURL) || '');
      this.config = (context && context.config && typeof context.config === 'object') ? context.config : {};
      this.ready = loadScript(`${this.baseURL}/validate.js`)
        .then(() => { this.validate = window.OverlayWidgetsValidate; })
        .catch(err => console.warn('[widgets] could not load validator', err));
      this.setupRevealHooks();
    },

    setupRevealHooks() {
      const trySetup = () => {
        const deck = window.deck;
        if (deck && typeof deck.on === 'function') {
          const refresh = () => this.refresh();
          deck.on('ready', refresh);
          deck.on('slidechanged', refresh);
          deck.on('fragmentshown', refresh);
          deck.on('overviewshown', refresh);
          deck.on('overviewhidden', refresh);
          deck.on('resize', () => this.reposition());
          // `ready` may already have fired.
          if (document.querySelector('.reveal .present')) refresh();
        } else {
          setTimeout(trySetup, 100);
        }
      };
      trySetup();
    },

    // Slides whose widgets should be mounted: the current one, plus its
    // neighbours so slow widgets (web requests) are painted before the slide is
    // shown. Vertical and horizontal neighbours are both covered because
    // getSlides() is a flat list in presentation order.
    wantedSections() {
      const deck = window.deck;
      const wanted = new Set();
      const current = deck?.getCurrentSlide?.() || document.querySelector('.reveal .slides section.present:not(:has(section.present))');
      if (!current) return wanted;
      wanted.add(current);
      const slides = typeof deck?.getSlides === 'function' ? deck.getSlides() : [];
      const i = slides.indexOf(current);
      if (i >= 0) {
        for (let n = 1; n <= PRELOAD_AHEAD; n++) if (slides[i + n]) wanted.add(slides[i + n]);
        if (slides[i - 1]) wanted.add(slides[i - 1]);
      }
      return wanted;
    },

    // Mount widgets on the current and adjacent slides, unmount the rest.
    refresh() {
      const deck = window.deck;
      const overview = typeof deck?.isOverview === 'function' && deck.isOverview();
      const wanted = overview ? new Set() : this.wantedSections();
      document.querySelectorAll('.ow-widget').forEach(el => {
        const section = el.closest('section');
        const visible = section && wanted.has(section);
        if (visible && !this.active.has(el)) this.mount(el);
        else if (!visible && this.active.has(el)) this.unmount(el);
      });
      for (const el of Array.from(this.active.keys())) {
        if (!el.isConnected) this.unmount(el);
      }
      // Section offsets change as Reveal lays out the new current slide.
      this.reposition();
    },

    unmount(el) {
      const entry = this.active.get(el);
      this.active.delete(el);
      if (!entry) return;
      entry.disposed = true;
      clearTimeout(entry.readyTimer);
      try { entry.cleanup?.(); } catch (err) { console.warn('[widgets] cleanup failed', err); }
      el.replaceChildren();
    },

    async loadManifest(id) {
      if (!this.manifests.has(id)) {
        this.manifests.set(id, fetch(`${this.baseURL}/overlaywidgets/${id}/manifest.json`)
          .then(res => {
            if (!res.ok) throw new Error(`unknown widget "${id}"`);
            return res.json();
          }));
      }
      return this.manifests.get(id);
    },

    slideSize() {
      const cfg = window.deck?.getConfig?.() || {};
      return { w: Number(cfg.width) || REF_W, h: Number(cfg.height) || REF_H };
    },

    // Places the wrapper in slide coordinates. Sections are laid out by Reveal
    // (centered, offset), so subtract the section's own offset.
    place(entry) {
      const { w: slideW, h: slideH } = this.slideSize();
      const section = entry.el.closest('section');
      const offX = section ? section.offsetLeft : 0;
      const offY = section ? section.offsetTop : 0;
      const wrap = entry.wrapper;
      const p = entry.payload;
      wrap.style.left = `${p.x * slideW - offX}px`;
      wrap.style.top = `${p.y * slideH - offY}px`;
      wrap.style.width = `${p.w * slideW}px`;
      wrap.style.height = `${p.h * slideH}px`;
      entry.box.style.transform = `scale(${(p.w * slideW) / entry.boxW}, ${(p.h * slideH) / entry.boxH})`;
    },

    reposition() {
      for (const entry of this.active.values()) {
        if (entry.wrapper) this.place(entry);
      }
    },

    async mount(el) {
      const entry = { el, disposed: false };
      this.active.set(el, entry);
      try {
        await this.ready;
        const payload = JSON.parse(decodeURIComponent(el.dataset.ow || ''));
        const manifest = await this.loadManifest(payload.name);
        if (entry.disposed) return;

        const def = manifest.defaultSize || { w: 400, h: 300 };
        const w = clamp(Number.isFinite(payload.w) ? payload.w : def.w / REF_W, 0.01, 1);
        const h = clamp(Number.isFinite(payload.h) ? payload.h : def.h / REF_H, 0.01, 1);
        entry.payload = { name: payload.name, x: clamp(payload.x, -1, 1), y: clamp(payload.y, -1, 1), w, h };
        entry.boxW = Math.max(10, Math.round(w * REF_W));
        entry.boxH = Math.max(10, Math.round(h * REF_H));

        const params = Object.freeze(this.validate.validateParams(manifest, payload.parameters));

        const section = el.closest('section');
        if (section && getComputedStyle(section).position === 'static') section.style.position = 'relative';

        const wrapper = document.createElement('div');
        // Hidden until the widget reports its first paint (see markReady below).
        wrapper.style.cssText = 'position:absolute;overflow:hidden;pointer-events:none;z-index:10;'
          + 'opacity:0;transition:opacity .2s';
        const box = document.createElement('div');
        box.style.cssText = `position:absolute;left:0;top:0;width:${entry.boxW}px;height:${entry.boxH}px;`
          + 'transform-origin:0 0;overflow:hidden';
        wrapper.appendChild(box);
        el.replaceChildren(wrapper);
        entry.wrapper = wrapper;
        entry.box = box;
        this.place(entry);

        let shown = false;
        const markReady = () => {
          if (shown || entry.disposed) return;
          shown = true;
          clearTimeout(entry.readyTimer);
          wrapper.style.opacity = '1';
        };
        // Safety net for widgets that opt into manual readiness but never call it.
        entry.readyTimer = setTimeout(markReady, READY_TIMEOUT_MS);

        const instance = `${payload.name}:${this.counter++}`;
        const api = Object.freeze({
          mode: this.hostMode(),
          locale: document.documentElement.lang || navigator.language || 'en',
          location: payload.location ? Object.freeze({ ...payload.location }) : null,
          storage: createStorage(`widget:${payload.name}:${el.closest('section')?.dataset?.id || instance}:`),
          fetch: (endpoint, args) => this.hostFetch(payload.name, params, endpoint, args),
          ready: markReady
        });

        const module = await import(`${this.baseURL}/overlaywidgets/${payload.name}/${manifest.entry}`);
        if (entry.disposed) return;
        const result = await module.mount(box, { width: entry.boxW, height: entry.boxH, params, api });
        if (typeof result === 'function') entry.cleanup = result;
        else if (result && typeof result.destroy === 'function') entry.cleanup = () => result.destroy();
        // Widgets that paint later (after api.fetch) call api.ready() themselves.
        if (module.manualReady !== true) markReady();
        if (entry.disposed) { // slide changed while mounting
          try { entry.cleanup?.(); } catch { /* ignore */ }
        }
      } catch (err) {
        console.warn('[widgets] could not mount widget:', err);
      }
    },

    // api.mode for widgets: 'editor' inside a slide-editor preview (any iframe), 'live' on a real screen.
    // Picture-in-picture is also an iframe but is a live screen.
    hostMode() {
      return window.self !== window.top && !window.RevelationElectronAPI?.isInPictureInPicture() ? 'editor' : 'live';
    },

    async hostFetch(widget, params, endpoint, args) {
      const bridge = findBridge();
      if (!bridge) throw fetchError('upstream_unreachable');
      const res = await bridge({ widget, endpoint, params, args: args || {} });
      if (!res || res.error) throw fetchError(res?.error?.reason || 'upstream_unreachable', res?.error?.status);
      return res;
    }
  };
})();
