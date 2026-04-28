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
          return `<h2 class="countdown" data-countdown-mode="ontime" data-ontime-timer="${esc(timer)}">--:--</h2>`;
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
      window.revealCountdownHandlers['ontime'] = (el, activeIntervals) => {
        this._startOntimeCountdown(el, activeIntervals);
      };
    },

    _startOntimeCountdown(el, activeIntervals) {
      const url = String(this.config.pollUrl || '').trim();
      if (!url) {
        el.textContent = '(no URL)';
        return;
      }

      const timerKey = String(el.dataset.ontimeTimer || 'current').trim();

      const pad2 = (v) => String(Math.abs(v)).padStart(2, '0');
      const formatSigned = (seconds) => {
        const sign = seconds < 0 ? '-' : '';
        const abs = Math.abs(Math.floor(seconds));
        const h = Math.floor(abs / 3600);
        const m = Math.floor((abs % 3600) / 60);
        const s = abs % 60;
        return h > 0 ? `${sign}${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${sign}${pad2(m)}:${pad2(s)}`;
      };

      // displaySeconds: whole seconds currently shown on screen.
      // serverSyncMs/serverSyncAt: server's timer value (ms) and the local
      // timestamp when that poll returned — used to project the server value
      // forward in time without requiring a network round-trip every second.
      let displaySeconds = null;
      let serverSyncMs = null;
      let serverSyncAt = null;
      let isPaused = false;
      let isStopped = true; // start stopped until first successful poll

      const SNAP_THRESHOLD = 3; // jump if local drifts more than this many seconds from server

      const tick = () => {
        if (isStopped) {
          el.textContent = '--:--';
          return;
        }

        if (isPaused) {
          if (displaySeconds !== null) el.textContent = formatSigned(displaySeconds);
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

        el.textContent = formatSigned(displaySeconds);
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
            isPaused = playback !== 'play';
            serverSyncMs = ms;
            serverSyncAt = Date.now();
            // Seed the display immediately on first poll; subsequent
            // updates come from tick() so the interval stays steady.
            if (displaySeconds === null) {
              displaySeconds = Math.floor(ms / 1000);
              el.textContent = formatSigned(displaySeconds);
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
