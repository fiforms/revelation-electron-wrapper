// plugins/immich/plugin.js
//
// Server-side plugin for Immich Slideshow sync.
//
// Master behaviour:
//   - Opens the Immich share URL on the local presentation screen.
//   - Sends an `open-presentation` peer command so followers open the same URL.
//   - Attaches a `before-input-event` hook to the presentation window's webContents
//     so every navigation key (arrows, space, escape…) is relayed to peers via a
//     custom `immich-navigate` peer command.
//
// Follower behaviour:
//   - `open-presentation` is already handled by the core (opens the URL).
//   - `immich-navigate` is handled here: we inject the key into the local
//     presentation window using webContents.sendInputEvent(), which bypasses
//     cross-origin restrictions that would block JS injection.

const path = require('path');
const { presentationWindow } = require(path.join(__dirname, '..', '..', 'lib', 'presentationWindow'));

// Keys whose keydown events should be relayed to peers.
const RELAY_KEYS = new Set([
  'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown',
  ' ', 'Escape', 'PageUp', 'PageDown', 'Enter', 'f', 'F'
]);

// Map from before-input-event key names to Chromium sendInputEvent keyCode names.
const KEY_TO_KEYCODE = {
  'ArrowRight': 'Right',
  'ArrowLeft':  'Left',
  'ArrowUp':    'Up',
  'ArrowDown':  'Down',
  ' ':          'Space',
  'Escape':     'Escape',
  'PageUp':     'Prior',
  'PageDown':   'Next',
  'Enter':      'Return',
  'f':          'F',
  'F':          'F',
};

// Peers may only inject these keycodes (the values of KEY_TO_KEYCODE).
const ALLOWED_NAV_KEYCODES = new Set(Object.values(KEY_TO_KEYCODE));

let AppCtx = null;
let inputListener = null;
let isSyncActive = false;

function stopSync() {
  const pw = presentationWindow.presWindow;
  if (pw && !pw.isDestroyed() && inputListener) {
    pw.webContents.off('before-input-event', inputListener);
    AppCtx && AppCtx.log('[immich] Input relay hook removed');
  }
  inputListener = null;
  isSyncActive = false;
}

const immichPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 90,
  configTemplate: [],

  register(AppContext) {
    AppCtx = AppContext;

    // Register the peer command handler for immich-navigate.
    // pluginPeerCommandHandlers is initialised on AppContext in main.js and
    // dispatched by handlePeerCommand() in peerCommandClient.js.
    AppContext.pluginPeerCommandHandlers.set('immich-navigate', (command) => {
      const { key } = command.payload || {};
      if (!key || !ALLOWED_NAV_KEYCODES.has(key)) return;
      const pw = presentationWindow.presWindow;
      if (!pw || pw.isDestroyed()) return;
      AppContext.log(`[immich] Relaying nav key to local presentation: ${key}`);
      pw.webContents.sendInputEvent({ type: 'keyDown', keyCode: key });
      pw.webContents.sendInputEvent({ type: 'keyUp',  keyCode: key });
    });

    AppContext.log('[immich-plugin] Registered');
  },

  api: {
    'start-immich-sync': async function (_event, data) {
      const { url } = data || {};
      if (!url) return { success: false, error: 'URL is required' };

      let parsed;
      try { parsed = new URL(url); } catch {
        return { success: false, error: 'Invalid URL' };
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { success: false, error: 'Only http(s) URLs are allowed' };
      }

      // Clean up any previous sync session.
      stopSync();

      const { sendPeerCommand } = require(path.join(__dirname, '..', '..', 'lib', 'peerCommandClient'));

      // Ask peers to open the same URL.  The core already handles open-presentation.
      try {
        await sendPeerCommand(AppCtx, { type: 'open-presentation', payload: { url } });
        AppCtx.log(`[immich] Sent open-presentation to peers: ${url}`);
      } catch (err) {
        AppCtx.log(`[immich] Could not reach peers (continuing locally): ${err.message}`);
      }

      // Open the URL on the local presentation screen (fullscreen, external URL).
      await presentationWindow.openWindow(AppCtx, url, null, true);

      // Attach the before-input-event hook once the window exists.
      // A short delay lets the BrowserWindow settle; the hook itself is idempotent.
      const attachHook = () => {
        const pw = presentationWindow.presWindow;
        if (!pw || pw.isDestroyed()) {
          AppCtx.log('[immich] Presentation window gone before hook could attach');
          return;
        }

        inputListener = (_ev, input) => {
          if (input.type !== 'keyDown') return;
          if (!RELAY_KEYS.has(input.key)) return;

          const keyCode = KEY_TO_KEYCODE[input.key] || input.key;
          sendPeerCommand(AppCtx, {
            type: 'immich-navigate',
            payload: { key: keyCode }
          }).catch(err => AppCtx.log(`[immich] Peer relay error: ${err.message}`));
        };

        pw.webContents.on('before-input-event', inputListener);

        // Auto-clean when the user closes the window.
        pw.once('closed', () => {
          inputListener = null;
          isSyncActive = false;
          AppCtx && AppCtx.log('[immich] Presentation window closed; sync ended');
        });

        isSyncActive = true;
        AppCtx.log('[immich] Input relay hook attached');
      };

      setTimeout(attachHook, 400);
      return { success: true };
    },

    'stop-immich-sync': function (_event, _data) {
      stopSync();
      return { success: true };
    },

    'get-sync-status': function (_event, _data) {
      return { active: isSyncActive };
    }
  }
};

module.exports = immichPlugin;
