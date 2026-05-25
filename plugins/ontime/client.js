(function () {
  const PLUGIN_NAME = 'ontime';

  // Block-style YAML pattern, same convention as the lowerthirds plugin.
  // Matches:
  //   :ontime:
  //     type: countdown
  //     timer: current
  const BLOCK_RE = /^:ontime:\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))+)/gm;

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  window.RevelationPlugins = window.RevelationPlugins || {};
  window.RevelationPlugins[PLUGIN_NAME] = {
    name: PLUGIN_NAME,
    baseURL: '',
    config: {},
    lastPayload: null,

    preprocessMarkdown(md, context) {
      const parseYAML = context && typeof context.parseYAML === 'function'
        ? context.parseYAML
        : null;

      return md.replace(BLOCK_RE, (match, block) => {
        let params = {};
        if (parseYAML) {
          try {
            const lines = block.split('\n').filter(l => l.trim().length > 0);
            const minIndent = lines.reduce((min, l) => {
              const m = l.match(/^([ \t]+)/);
              return m ? Math.min(min, m[1].length) : min;
            }, Infinity);
            const stripped = block
              .split('\n')
              .map(l => (isFinite(minIndent) && l.length >= minIndent) ? l.slice(minIndent) : l)
              .join('\n');
            params = parseYAML(stripped) || {};
          } catch {
            params = {};
          }
        }

        const type = String(params.type || '').trim().toLowerCase();

        if (type === 'countdown') {
          const timer = String(params.timer || 'current').trim();
          const offset = Number(params.displayOffset);
          const offsetAttr = Number.isFinite(offset) && offset !== 0
            ? ` data-ontime-offset="${esc(String(offset))}"`
            : '';
          const actions = (params.actions && typeof params.actions === 'object') ? params.actions : {};
          const actionsAttr = Object.keys(actions).length > 0
            ? ` data-ontime-actions="${esc(JSON.stringify(actions))}"`
            : '';
          return `<h2 class="countdown" data-countdown-mode="ontime" data-ontime-timer="${esc(timer)}"${offsetAttr}${actionsAttr}>--:--</h2>`;
        }

        if (type === 'lowerthird') {
          const style = String(params.style || 'colorful').trim();
          const data = esc(JSON.stringify(params));
          return `<div class="lt-lower-third" data-lt-theme="${esc(style)}" data-lt-name="" data-lt-title="" data-lt-manager="ontime" data-lt-manager-data="${data}"></div>\n\n`;
        }

        // Unknown type — emit nothing so the slide isn't broken.
        return '';
      });
    },

    init(context) {
      this.baseURL = String((context && context.baseURL) || '');
      this.config = (context && context.config && typeof context.config === 'object')
        ? context.config
        : {};

      window.revealCountdownHandlers = window.revealCountdownHandlers || {};
      window.revealCountdownHandlers['ontime'] = (el, activeIntervals, deck) => {
        this._startOntimeCountdown(el, activeIntervals, deck);
      };

      const url = String(this.config.pollUrl || '').trim();
      if (url) {
        const seconds = Number(this.config.pollIntervalSeconds);
        const intervalMs = Math.max(1, Number.isFinite(seconds) && seconds > 0 ? seconds : 5) * 1000;
        this._startLowerThirdsPoll(url, intervalMs);
      }
    },

    _startLowerThirdsPoll(url, intervalMs) {
      const poll = () => {
        if (!document.querySelector('[data-lt-manager="ontime"]')) return;
        fetch(url)
          .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
          .then(data => { this._updateLowerThirds(data && data.payload); })
          .catch(() => {});
      };
      setInterval(poll, intervalMs);
      poll();
    },

    _resolvePath(obj, path) {
      return String(path).split('.').reduce(
        (acc, key) => (acc != null && typeof acc === 'object' ? acc[key] : undefined),
        obj
      );
    },

    _renderLowerThirdElement(el, payload) {
      let config;
      try { config = JSON.parse(el.dataset.ltManagerData || '{}'); } catch { return; }
      const blockKey = el.getAttribute('data-lt-block');
      if (!blockKey || !config[blockKey]) return;
      const configValue = String(config[blockKey]);
      let text;
      if (configValue.startsWith('$')) {
        const value = this._resolvePath(payload, configValue.slice(1));
        text = (value != null) ? String(value) : '';
      } else {
        text = configValue;
      }
      if (Number.isInteger(config.index) && text.includes(';')) {
        const parts = text.split(';').map(s => s.trim());
        text = parts[config.index] ?? '';
      }
      el.textContent = text;
    },

    _updateLowerThirds(payload) {
      if (!payload) return;
      this.lastPayload = payload;
      document.querySelectorAll('[data-lt-manager="ontime"]').forEach(el => {
        this._renderLowerThirdElement(el, payload);
      });
    },

    applyDataToElement(el) {
      if (!this.lastPayload) return;
      this._renderLowerThirdElement(el, this.lastPayload);
    },

    _startOntimeCountdown(el, activeIntervals, deck) {
      const url = String(this.config.pollUrl || '').trim();
      if (!url) {
        el.textContent = '(no URL)';
        return;
      }

      const timerKey = String(el.dataset.ontimeTimer || 'current').trim();
      const actions = JSON.parse(el.dataset.ontimeActions || '{}');

      // displayOffset shifts only the on-screen text by a fixed number of
      // seconds. Triggers (zero/atTime/atInterval) always reason about OnTime's
      // real reported value, so the offset is added at paint time only.
      const offsetSeconds = Number(el.dataset.ontimeOffset) || 0;

      // advanceLoop behaves like a normal advance until the last slide of the
      // current column, where it loops back to that column's first slide
      // instead of carrying on into the next column.
      const advanceLoop = () => {
        if (!deck) return;
        const routes = typeof deck.availableRoutes === 'function' ? deck.availableRoutes() : {};
        const frags = typeof deck.availableFragments === 'function' ? deck.availableFragments() : {};
        if (routes.down || frags.next) {
          deck.next();
        } else {
          const { h } = deck.getIndices();
          deck.slide(h, 0);
        }
      };

      const runAction = (name) => {
        switch (String(name)) {
          case 'advance': deck?.next(); break;
          case 'advanceColumn': deck?.right(); break;
          case 'advanceLoop': advanceLoop(); break;
        }
      };

      // atTime: fire once each time the timer counts down past `time` seconds.
      // Accepts a single { time, action } or an array of them.
      const atTimeTriggers = []
        .concat(actions.atTime || [])
        .filter(t => t && typeof t === 'object' && Number.isFinite(Number(t.time)) && t.action)
        .map(t => ({ time: Number(t.time), action: String(t.action), fired: false }));

      // atInterval: fire `action` every `interval` running seconds — used to
      // cycle through a column's slides like a reel while the timer plays.
      const it = actions.atInterval;
      const intervalTrigger = (it && typeof it === 'object' && Number(it.interval) > 0 && it.action)
        ? { interval: Number(it.interval), action: String(it.action) }
        : null;
      let intervalElapsed = 0;

      const pad2 = (v) => String(Math.abs(v)).padStart(2, '0');
      const formatSigned = (seconds) => {
        const sign = seconds < 0 ? '-' : '';
        const abs = Math.abs(Math.floor(seconds));
        const h = Math.floor(abs / 3600);
        const m = Math.floor((abs % 3600) / 60);
        const s = abs % 60;
        return h > 0 ? `${sign}${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${sign}${pad2(m)}:${pad2(s)}`;
      };

      // Render the timer, applying the cosmetic display offset.
      const paint = (seconds) => { el.textContent = formatSigned(seconds + offsetSeconds); };

      // displaySeconds: OnTime's real projected timer value in whole seconds —
      // what triggers act on. The shown text adds offsetSeconds via paint().
      // serverSyncMs/serverSyncAt: server's timer value (ms) and the local
      // timestamp when that poll returned — used to project the server value
      // forward in time without requiring a network round-trip every second.
      let displaySeconds = null;
      let prevDisplaySeconds = null;
      let serverSyncMs = null;
      let serverSyncAt = null;
      let isPaused = false;
      let isStopped = true; // start stopped until first successful poll
      let zeroCrossed = false; // guards zero-crossing actions from firing repeatedly

      const SNAP_THRESHOLD = 3; // jump if local drifts more than this many seconds from server

      const tick = () => {
        if (isStopped) {
          el.textContent = '--:--';
          return;
        }

        if (isPaused) {
          if (displaySeconds !== null) paint(displaySeconds);
          return;
        }

        // Project what the server timer value would be right now.
        const serverSeconds = Math.floor((serverSyncMs - (Date.now() - serverSyncAt)) / 1000);

        if (displaySeconds === null) {
          displaySeconds = serverSeconds;
        } else {
          const nextLocal = displaySeconds - 1;
          // Within threshold: keep counting locally for smooth display.
          // Outside threshold: snap to server value to correct drift.
          displaySeconds = Math.abs(nextLocal - serverSeconds) <= SNAP_THRESHOLD
            ? nextLocal
            : serverSeconds;
        }

        paint(displaySeconds);

        // Reset the guard when the timer is clearly positive so a new
        // countdown on the same slide can fire actions again.
        if (displaySeconds > 0) zeroCrossed = false;

        if (!zeroCrossed && prevDisplaySeconds !== null && prevDisplaySeconds > 0 && displaySeconds <= 0) {
          zeroCrossed = true;
          if (actions.zero) runAction(actions.zero);
        }

        // atTime: fire on the downward crossing past each threshold, once per
        // crossing. The guard resets if the timer climbs back above it.
        for (const t of atTimeTriggers) {
          if (displaySeconds > t.time) {
            t.fired = false;
          } else if (!t.fired && prevDisplaySeconds !== null && prevDisplaySeconds > t.time) {
            t.fired = true;
            runAction(t.action);
          }
        }

        // atInterval: one tick per running second; fire when the count reaches
        // the configured interval, then start counting again.
        if (intervalTrigger) {
          intervalElapsed += 1;
          if (intervalElapsed >= intervalTrigger.interval) {
            intervalElapsed = 0;
            runAction(intervalTrigger.action);
          }
        }

        prevDisplaySeconds = displaySeconds;
      };

      const poll = () => {
        fetch(url)
          .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          })
          .then(data => {
            const playback = data?.payload?.timer?.playback;
            const ms = data?.payload?.timer?.[timerKey];

            if (playback === 'stop' || !Number.isFinite(ms)) {
              isStopped = true;
              displaySeconds = null;
              return;
            }

            isStopped = false;
            isPaused = playback !== 'play' && playback !== 'roll';
            serverSyncMs = ms;
            serverSyncAt = Date.now();
            // Seed the display immediately on first poll; subsequent
            // updates come from tick() so the interval stays steady.
            if (displaySeconds === null) {
              displaySeconds = Math.floor(ms / 1000);
              paint(displaySeconds);
            }
          })
          .catch(() => {
            // Leave the last displayed value intact on network errors.
          });
      };

      // Align first tick to the next whole-second boundary on the system clock
      // so the display changes feel sharp and predictable.
      const msToNextSecond = 1000 - (Date.now() % 1000);
      activeIntervals.push(window.setTimeout(() => {
        tick();
        activeIntervals.push(window.setInterval(tick, 1000));
      }, msToNextSecond));

      poll();
      activeIntervals.push(window.setInterval(poll, 5000));
    }
  };
})();
