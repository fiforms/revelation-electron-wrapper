// KWin Window Helper Module
//
// Under KDE Plasma on Wayland, KWin ignores setBounds() like other compositors, but
// it accepts scripts over D-Bus at runtime, so nothing needs installing. For each
// placement we fill in kwin-script/place-window.js, load it into KWin and wait for
// it to unload itself, which it does after placing the window.

// API: isKdeWayland, getStatus, placeWindow. Callers: presentationWindow.placeOnWaylandDisplay and
// otherEventHandlers (get-runtime-info). The GNOME counterpart is gnomeWindowHelper.js.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { withTitleToken } = require('./windowTitleToken');

const TEMPLATE_PATH = path.join(__dirname, '..', 'kwin-script', 'place-window.js');
// How long to wait for KWin to find the window (it may not be mapped yet).
const DONE_TIMEOUT_MS = 3000;
const POLL_MS = 100;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// dbus-send ships with D-Bus itself, so unlike gdbus/qdbus it is always present.
function callScripting(method, args = []) {
  return new Promise((resolve) => {
    execFile('dbus-send', [
      '--session', '--print-reply', '--dest=org.kde.KWin',
      '/Scripting', `org.kde.kwin.Scripting.${method}`,
      ...args
    ], { timeout: 2000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || err?.message || '') });
    });
  });
}

const kwinWindowHelper = {
  isKdeWayland() {
    const desktops = String(process.env.XDG_CURRENT_DESKTOP || '').split(':');
    return process.env.XDG_SESSION_TYPE === 'wayland'
      && desktops.some((d) => d.trim().toUpperCase() === 'KDE');
  },

  // state: 'unsupported' | 'available' | 'unavailable'
  async getStatus() {
    if (!this.isKdeWayland()) return { state: 'unsupported' };
    const probe = await callScripting('isScriptLoaded', ['string:revelation_probe']);
    return { state: probe.ok ? 'available' : 'unavailable' };
  },

  // Moves win onto the monitor containing bounds. With fullscreen, the window fills
  // that monitor; otherwise it is moved and resized to bounds.
  // Resolves to 'placed' | 'not-found' | 'load-failed' | 'unavailable' | 'unsupported'.
  async placeWindow(win, bounds, { fullscreen = true } = {}) {
    if (!this.isKdeWayland()) return 'unsupported';
    if (!win || win.isDestroyed()) return 'not-found';

    return withTitleToken(win, async (token, hex) => {
      const pluginName = `revelation_place_${hex}`;
      const params = {
        token,
        pluginName,
        fullscreen: !!fullscreen,
        bounds: {
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height)
        }
      };
      let tempDir = null;
      try {
        const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revelation-kwin-'));
        const scriptPath = path.join(tempDir, 'place-window.js');
        fs.writeFileSync(scriptPath, template.replace('__PARAMS__', () => JSON.stringify(params)));

        const loaded = await callScripting('loadScript', [`string:${scriptPath}`, `string:${pluginName}`]);
        if (!loaded.ok) return 'unavailable';
        const id = loaded.stdout.match(/int32\s+(-?\d+)/);
        if (!id || Number.parseInt(id[1], 10) < 0) return 'load-failed';
        const started = await callScripting('start');
        if (!started.ok) return 'unavailable';

        const deadline = Date.now() + DONE_TIMEOUT_MS;
        while (Date.now() < deadline) {
          await delay(POLL_MS);
          if (win.isDestroyed()) return 'not-found';
          const check = await callScripting('isScriptLoaded', [`string:${pluginName}`]);
          if (check.ok && /boolean false/.test(check.stdout)) return 'placed';
        }
        return 'not-found';
      } finally {
        // No-op when the script already unloaded itself.
        await callScripting('unloadScript', [`string:${pluginName}`]);
        if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  }
};

module.exports = kwinWindowHelper;
