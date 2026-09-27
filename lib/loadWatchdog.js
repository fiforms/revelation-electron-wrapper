// Load a URL into a window and make sure it actually comes up.
//
// Under heavy load (memory pressure, a cold Vite dev server, a busy peer over
// Wi-Fi) a page can stay white without ever firing did-fail-load: the HTML
// arrives, but a module import stalls or fails, so the deck never
// initializes. The watchdog polls the page for readiness and reloads it a
// few times if it doesn't get there.

// Ready = document fully loaded and, if the page has a Reveal deck (or is a
// presentation page), the deck has finished initializing.
const DEFAULT_READY_CHECK = `(() => {
  if (document.readyState !== 'complete') return false;
  const d = window.deck;
  if (d && typeof d.isReady === 'function') return !!d.isReady();
  return !/\\/presentation\\.html$/.test(location.pathname);
})()`;

const CHECK_TIMEOUT_MS = 2000;

// One active watchdog per webContents; a newer load supersedes the older one.
const active = new WeakMap();

function stripHash(url) {
    try {
        const u = new URL(url);
        u.hash = '';
        return u.href;
    } catch {
        return String(url || '');
    }
}

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(false), ms))
    ]);
}

// Resolves { ok, attempts, cancelled } — never rejects.
function loadWithWatchdog(win, url, options = {}) {
    const {
        AppContext,
        label = 'window',
        readyTimeoutMs = 15000,
        maxRetries = 2,
        pollMs = 500,
        readyCheck = DEFAULT_READY_CHECK
    } = options;
    const log = (...a) => AppContext?.log?.(...a);
    const logError = (...a) => AppContext?.error?.(...a);

    if (!win || win.isDestroyed()) return Promise.resolve({ ok: false, attempts: 0, cancelled: true });
    const wc = win.webContents;

    const previous = active.get(wc);
    if (previous) previous.cancel();

    const target = stripHash(url);

    return new Promise((resolve) => {
        const state = { cancelled: false, failedAt: 0, timer: null };
        let attempt = 0;
        let attemptStart = 0;
        let expectingOwnNavigation = false;
        const onClosed = () => state.cancel();

        const finish = (result) => {
            if (state.timer) clearTimeout(state.timer);
            state.timer = null;
            if (!wc.isDestroyed()) {
                wc.removeListener('did-fail-load', onFail);
                wc.removeListener('did-start-navigation', onStartNavigation);
            }
            if (!win.isDestroyed()) win.removeListener('closed', onClosed);
            if (active.get(wc) === state) active.delete(wc);
            resolve({ ...result, attempts: attempt });
        };

        state.cancel = () => {
            if (state.cancelled) return;
            state.cancelled = true;
            finish({ ok: false, cancelled: true });
        };

        // -3 is ERR_ABORTED (navigation replaced by another); not a real failure.
        const onFail = (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            if (!isMainFrame || errorCode === -3) return;
            logError(`⚠️ ${label} failed to load (${errorCode} ${errorDescription}) on attempt ${attempt}.`);
            state.failedAt = Date.now();
        };

        // Something else navigated this window elsewhere — stop watching.
        const onStartNavigation = (event, legacyUrl, legacyInPlace, legacyMainFrame) => {
            const navUrl = event?.url ?? legacyUrl;
            const isMainFrame = event?.isMainFrame ?? legacyMainFrame;
            const isSameDocument = event?.isSameDocument ?? legacyInPlace;
            if (!isMainFrame || isSameDocument) return;
            // The first navigation after our own loadURL is ours, even if
            // Chromium normalized the URL differently.
            if (expectingOwnNavigation) {
                expectingOwnNavigation = false;
                return;
            }
            // Same URL again (e.g. Vite's full reload after optimizing deps) is fine.
            if (stripHash(navUrl) !== target) state.cancel();
        };

        const startAttempt = () => {
            attempt += 1;
            attemptStart = Date.now();
            state.failedAt = 0;
            expectingOwnNavigation = true;
            if (attempt > 1) log(`🔄 Reloading ${label} (attempt ${attempt} of ${maxRetries + 1}): ${url}`);
            wc.loadURL(url).catch(() => {
                // Failures are reported through did-fail-load / the readiness poll.
            });
            schedulePoll();
        };

        const retryOrGiveUp = (reason) => {
            if (attempt <= maxRetries) {
                log(`⏱️ ${label} not ready (${reason}); retrying.`);
                startAttempt();
            } else {
                logError(`❌ ${label} still not ready after ${attempt} attempts (${reason}): ${url}`);
                finish({ ok: false, cancelled: false });
            }
        };

        const poll = async () => {
            state.timer = null;
            if (state.cancelled) return;
            if (win.isDestroyed() || wc.isDestroyed()) {
                state.cancel();
                return;
            }

            // A hard load failure retries after a short backoff instead of
            // waiting out the full readiness timeout.
            if (state.failedAt) {
                if (Date.now() - state.failedAt >= 1000 * attempt) retryOrGiveUp('load failed');
                else schedulePoll();
                return;
            }

            let ready = false;
            try {
                ready = await withTimeout(wc.executeJavaScript(readyCheck), CHECK_TIMEOUT_MS);
            } catch {
                ready = false; // page mid-navigation or not scriptable yet
            }
            if (state.cancelled) return;
            if (ready === true) {
                if (attempt > 1) log(`✅ ${label} ready after ${attempt} attempts.`);
                finish({ ok: true, cancelled: false });
                return;
            }
            if (Date.now() - attemptStart >= readyTimeoutMs) {
                retryOrGiveUp(`no ready signal within ${Math.round(readyTimeoutMs / 1000)}s`);
                return;
            }
            schedulePoll();
        };

        const schedulePoll = () => {
            if (state.timer) clearTimeout(state.timer);
            state.timer = setTimeout(poll, pollMs);
        };

        active.set(wc, state);
        wc.on('did-fail-load', onFail);
        wc.on('did-start-navigation', onStartNavigation);
        win.once('closed', onClosed);
        startAttempt();
    });
}

module.exports = { loadWithWatchdog, DEFAULT_READY_CHECK };
