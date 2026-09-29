// GNOME Window Helper Module
//
// Under Wayland, GNOME ignores setBounds() and opens fullscreen windows on the
// monitor it chooses. The bundled GNOME Shell extension (gnome-extension/) can move
// windows, and this module talks to it over D-Bus via gdbus.

const { app } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { withTitleToken } = require('./windowTitleToken');

// The extension's version is the "version" field of its metadata.json.
// Bump it whenever extension.js changes so installed copies show as outdated.
const UUID = 'revelation-window-helper@pastordaniel.net';
const DBUS_DEST = 'org.gnome.Shell';
const OBJECT_PATH = '/org/revelation/WindowHelper';
const INTERFACE = 'org.revelation.WindowHelper';
const EXTENSION_FILES = ['metadata.json', 'extension.js'];

// How long to keep looking for a window that GNOME hasn't mapped yet.
const PLACE_ATTEMPTS = 20;
const PLACE_RETRY_MS = 100;

function run(command, args, timeout = 2000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || err?.message || '') });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function callHelper(method, args = []) {
  return run('gdbus', [
    'call', '--session',
    '--dest', DBUS_DEST,
    '--object-path', OBJECT_PATH,
    '--method', `${INTERFACE}.${method}`,
    // Without "--", negative coordinates (monitors left of/above the primary) parse as options.
    '--',
    ...args
  ]);
}

// Parses gsettings/gdbus output such as "['a', 'b']" or "@as []".
function parseStringList(text) {
  return [...String(text).matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

function formatStringList(items) {
  return `[${items.map((item) => `'${item}'`).join(', ')}]`;
}

function readMetadataVersion(dir) {
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
    return Number.isInteger(metadata.version) ? metadata.version : null;
  } catch {
    return null;
  }
}

async function setEnabledInSettings(enable) {
  const enabled = await run('gsettings', ['get', 'org.gnome.shell', 'enabled-extensions']);
  if (!enabled.ok) {
    return { ok: false, error: `Could not read GNOME extension settings: ${enabled.stderr}` };
  }
  const enabledList = parseStringList(enabled.stdout);
  const nextEnabled = enable
    ? (enabledList.includes(UUID) ? enabledList : [...enabledList, UUID])
    : enabledList.filter((id) => id !== UUID);
  if (nextEnabled.length !== enabledList.length) {
    const result = await run('gsettings', ['set', 'org.gnome.shell', 'enabled-extensions', formatStringList(nextEnabled)]);
    if (!result.ok) {
      return { ok: false, error: `Could not update enabled extensions: ${result.stderr}` };
    }
  }
  if (enable) {
    const disabled = await run('gsettings', ['get', 'org.gnome.shell', 'disabled-extensions']);
    const disabledList = disabled.ok ? parseStringList(disabled.stdout) : [];
    if (disabledList.includes(UUID)) {
      await run('gsettings', ['set', 'org.gnome.shell', 'disabled-extensions', formatStringList(disabledList.filter((id) => id !== UUID))]);
    }
  }
  return { ok: true };
}

const gnomeWindowHelper = {
  UUID,

  isGnomeWayland() {
    const desktops = String(process.env.XDG_CURRENT_DESKTOP || '').split(':');
    return process.env.XDG_SESSION_TYPE === 'wayland'
      && desktops.some((d) => d.trim().toUpperCase() === 'GNOME');
  },

  getBundledDir() {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'gnome-extension', UUID)
      : path.join(__dirname, '..', 'gnome-extension', UUID);
  },

  getInstallDir() {
    const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    return path.join(dataHome, 'gnome-shell', 'extensions', UUID);
  },

  async getActiveVersion() {
    const result = await callHelper('GetVersion');
    if (!result.ok) return null;
    const match = result.stdout.match(/uint32\s+(\d+)/);
    return match ? Number.parseInt(match[1], 10) : null;
  },

  getBundledVersion() {
    return readMetadataVersion(this.getBundledDir());
  },

  getInstalledVersion() {
    return readMetadataVersion(this.getInstallDir());
  },

  async getUserExtensionsDisabled() {
    const result = await run('gsettings', ['get', 'org.gnome.shell', 'disable-user-extensions']);
    return result.ok && result.stdout.trim() === 'true';
  },

  // state: 'unsupported' | 'active' | 'outdated' | 'installed-inactive' | 'not-installed'
  //   active/outdated: running in GNOME Shell (outdated = older than the bundled copy)
  //   installed-inactive: on disk but not running (needs login, or disabled)
  async getStatus() {
    if (!this.isGnomeWayland()) {
      return { state: 'unsupported' };
    }
    const bundledVersion = this.getBundledVersion();
    const installedVersion = this.getInstalledVersion();
    const activeVersion = await this.getActiveVersion();
    const userExtensionsDisabled = await this.getUserExtensionsDisabled();
    let state;
    if (activeVersion !== null) {
      state = bundledVersion !== null && activeVersion < bundledVersion ? 'outdated' : 'active';
    } else {
      state = installedVersion !== null ? 'installed-inactive' : 'not-installed';
    }
    return { state, activeVersion, installedVersion, bundledVersion, userExtensionsDisabled };
  },

  // Copies the extension into the user's extensions folder and enables it.
  // GNOME on Wayland only loads newly installed extensions after logging out and back in.
  async install() {
    if (!this.isGnomeWayland()) {
      return { success: false, error: 'Not a GNOME Wayland session.' };
    }
    const sourceDir = this.getBundledDir();
    const targetDir = this.getInstallDir();
    try {
      fs.mkdirSync(targetDir, { recursive: true });
      for (const file of EXTENSION_FILES) {
        fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
      }
    } catch (err) {
      return { success: false, error: `Could not copy extension files: ${err.message}` };
    }

    // Edit the settings directly: the shell's EnableExtension call rejects
    // extensions it hasn't loaded yet, which is always true right after install.
    const enabled = await setEnabledInSettings(true);
    if (!enabled.ok) {
      return { success: false, error: enabled.error };
    }
    // The extension can't load while GNOME's global "Use Extensions" switch is off.
    if (await this.getUserExtensionsDisabled()) {
      await run('gsettings', ['set', 'org.gnome.shell', 'disable-user-extensions', 'false']);
    }

    // GNOME Shell keeps running the copy it loaded at login, so a changed
    // version only takes effect after logging out and back in.
    const activeVersion = await this.getActiveVersion();
    return {
      success: true,
      installedVersion: this.getInstalledVersion(),
      needsRelogin: activeVersion === null || activeVersion !== this.getBundledVersion()
    };
  },

  // Turns the extension off in the running shell (if loaded), removes it from
  // GNOME's enabled list and deletes its folder. GNOME's global "Use Extensions"
  // switch is left as is, since other extensions may rely on it.
  async uninstall() {
    if (!this.isGnomeWayland()) {
      return { success: false, error: 'Not a GNOME Wayland session.' };
    }
    // Fails harmlessly when the shell hasn't loaded the extension.
    await run('gnome-extensions', ['disable', UUID]);
    const disabled = await setEnabledInSettings(false);
    if (!disabled.ok) {
      return { success: false, error: disabled.error };
    }
    try {
      fs.rmSync(this.getInstallDir(), { recursive: true, force: true });
    } catch (err) {
      return { success: false, error: `Could not delete extension files: ${err.message}` };
    }
    return { success: true, stillRunning: (await this.getActiveVersion()) !== null };
  },

  // Moves win onto the monitor containing bounds. With fullscreen, the window fills
  // that monitor; otherwise it is moved and resized to bounds.
  // Resolves to 'placed' | 'not-found' | 'no-monitor' | 'invalid-token' | 'unavailable' | 'unsupported'.
  async placeWindow(win, bounds, { fullscreen = true } = {}) {
    if (!this.isGnomeWayland()) return 'unsupported';
    if (!win || win.isDestroyed()) return 'not-found';

    return withTitleToken(win, async (token) => {
      const args = [
        token,
        String(Math.round(bounds.x)),
        String(Math.round(bounds.y)),
        String(Math.round(bounds.width)),
        String(Math.round(bounds.height)),
        fullscreen ? 'true' : 'false'
      ];
      for (let attempt = 0; attempt < PLACE_ATTEMPTS; attempt += 1) {
        if (win.isDestroyed()) return 'not-found';
        const result = await callHelper('PlaceWindow', args);
        if (!result.ok) return 'unavailable';
        const status = parseStringList(result.stdout)[0] || 'unavailable';
        if (status !== 'not-found') return status;
        await delay(PLACE_RETRY_MS);
      }
      return 'not-found';
    });
  }
};

module.exports = gnomeWindowHelper;
