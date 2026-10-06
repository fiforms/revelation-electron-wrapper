// plugins/infopanel/client.js  (browser)
// Hook: init (acts only when ?variant=confidencemonitor or ?variant=notes and `url` is set),
// cleanup. Docks an unsandboxed iframe at the bottom/right of the confidence monitor
// (shrinking .reveal) or below the notes view.
(function () {
  const PLUGIN_NAME = 'infopanel';

  // --- Helpers ---

  function getVariant() {
    try {
      return (new URLSearchParams(window.location.search).get('variant') || '').trim().toLowerCase();
    } catch {
      return '';
    }
  }

  function makeIframe(src) {
    const iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.style.cssText = [
      'display:block',
      'width:100%',
      'height:100%',
      'border:none',
      'background:#000'
    ].join(';');
    // Do not sandbox — the site needs to run freely (and Basic Auth must work).
    return iframe;
  }

  // --- Confidence Monitor ---

  function initConfidenceMonitor(url, config) {
    const position = String(config.panelPosition || 'bottom').trim().toLowerCase();
    const size = Math.max(5, Math.min(75, Number(config.panelSize) || 25));

    const panel = document.createElement('div');
    panel.id = 'revelation-infopanel';

    // Inject CSS that shrinks the reveal viewport so no slide content is hidden.
    // Reveal.js reads offsetWidth/Height of .reveal-viewport on resize events.
    const vpStyle = document.createElement('style');

    if (position === 'right') {
      panel.style.cssText = [
        'position:fixed',
        'top:0',
        'right:0',
        'width:' + size + 'vw',
        'height:100vh',
        'background:#0a0a0a',
        'border-left:2px solid rgba(255,255,255,0.12)',
        'z-index:1000',
        'overflow:hidden'
      ].join(';');

      vpStyle.textContent =
        'body[data-variant="confidencemonitor"] .reveal {' +
        '  width: calc(100% - ' + size + 'vw) !important;' +
        '}';
    } else {
      // bottom (default)
      panel.style.cssText = [
        'position:fixed',
        'bottom:0',
        'left:0',
        'width:100%',
        'height:' + size + 'vh',
        'background:#0a0a0a',
        'border-top:2px solid rgba(255,255,255,0.12)',
        'z-index:1000',
        'overflow:hidden'
      ].join(';');

      vpStyle.textContent =
        'body[data-variant="confidencemonitor"] .reveal {' +
        '  height: calc(100% - ' + size + 'vh) !important;' +
        '}';
    }

    document.head.appendChild(vpStyle);
    panel.appendChild(makeIframe(url));
    document.body.appendChild(panel);

    // Tell reveal.js to recalculate its layout with the reduced viewport.
    // Two rAFs ensure the browser has applied the CSS before we dispatch.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
      });
    });

    return null; // no watcher needed
  }

  // --- Notes View ---
  // Returns a NotesWatcher so the plugin can dispose it on cleanup.

  function initNotesView(url) {
    // Hide the panel on narrow/mobile layouts where the notes pane moves to the
    // top and the next-slide preview already fills the bottom full-width.
    const style = document.createElement('style');
    style.textContent = [
      '@media screen and (max-width: 1024px) {',
      '  #revelation-infopanel { display: none !important; }',
      '}'
    ].join('\n');
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'revelation-infopanel';
    // Align with the next-slide preview: same bottom edge and height,
    // sitting to the right of the preview tile (which spans --notes-main-width).
    panel.style.cssText = [
      'position:fixed',
      'bottom:0',
      'left:var(--notes-main-width, 40%)',
      'width:calc(100% - var(--notes-main-width, 40%))',
      'height:var(--notes-preview-height, 30dvh)',
      'background:#0a0a0a',
      'border-top:1px solid rgba(255,255,255,0.12)',
      'border-left:1px solid rgba(255,255,255,0.12)',
      'z-index:20',
      'overflow:hidden',
      'display:none'  // shown only when the current slide has no notes
    ].join(';');

    panel.appendChild(makeIframe(url));
    document.body.appendChild(panel);

    const watcher = new NotesWatcher(panel);
    watcher.start();
    return watcher;
  }

  // --- NotesWatcher ---
  // Watches the .speaker-notes element and shows/hides the panel based on
  // whether the current slide has any notes content.

  function NotesWatcher(panel) {
    this.panel = panel;
    this.observer = null;
    this._retryTimer = null;
  }

  NotesWatcher.prototype.start = function () {
    const hookReveal = () => {
      if (window.Reveal && typeof window.Reveal.on === 'function') {
        window.Reveal.on('ready', () => this.update());
        window.Reveal.on('slidechanged', () => this.update());
      }
    };

    if (document.readyState === 'complete') {
      hookReveal();
      this._attachObserver();
    } else {
      window.addEventListener('load', () => {
        hookReveal();
        this._attachObserver();
      }, { once: true });
    }
  };

  NotesWatcher.prototype._attachObserver = function () {
    const notesEl = document.querySelector('.reveal .speaker-notes');
    if (!notesEl) {
      // Speaker-notes element isn't in the DOM yet — retry shortly.
      this._retryTimer = setTimeout(() => {
        this._retryTimer = null;
        this._attachObserver();
      }, 300);
      return;
    }

    this.observer = new MutationObserver(() => this.update());
    this.observer.observe(notesEl, { childList: true, subtree: true, characterData: true });
    this.update();
  };

  NotesWatcher.prototype.update = function () {
    if (!this.panel) return;
    const notesEl = document.querySelector('.reveal .speaker-notes');
    const hasNotes = !!notesEl && notesEl.textContent.trim().length > 0;
    this.panel.style.display = hasNotes ? 'none' : 'block';
  };

  NotesWatcher.prototype.dispose = function () {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  };

  // --- Plugin registration ---

  window.RevelationPlugins = window.RevelationPlugins || {};
  window.RevelationPlugins[PLUGIN_NAME] = {
    name: PLUGIN_NAME,
    context: null,
    _watcher: null,

    init(context) {
      this.context = context || {};
      const url = String(this.context.config?.url || '').trim();
      if (!url) return;

      const variant = getVariant();

      if (variant === 'confidencemonitor') {
        this._watcher = initConfidenceMonitor(url, this.context.config || {});
      } else if (variant === 'notes') {
        this._watcher = initNotesView(url);
      }
    },

    cleanup() {
      if (this._watcher) {
        this._watcher.dispose();
        this._watcher = null;
      }
      const panel = document.getElementById('revelation-infopanel');
      if (panel) panel.remove();
    }
  };
})();
