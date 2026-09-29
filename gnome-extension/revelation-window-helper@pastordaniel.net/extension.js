// REVELation Window Helper — GNOME Shell extension
//
// Wayland does not let applications position their own windows, so Electron's
// setBounds() is ignored and fullscreen windows open on whatever monitor the
// compositor picks. This extension runs inside GNOME Shell (which can move
// windows) and exposes one D-Bus method the app calls to put a window on a
// specific monitor.
//
// The app identifies the window by temporarily setting its title to a random
// token, since every Electron window shares one PID. Only titles matching the
// token format are accepted, so the method can't be pointed at other apps' windows.

import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const OBJECT_PATH = '/org/revelation/WindowHelper';
const TOKEN_PATTERN = /^revelation-place:[0-9a-f]{32}$/;

const INTERFACE_XML = `
<node>
  <interface name="org.revelation.WindowHelper">
    <method name="GetVersion">
      <arg type="u" direction="out" name="version"/>
    </method>
    <method name="PlaceWindow">
      <arg type="s" direction="in" name="titleToken"/>
      <arg type="i" direction="in" name="x"/>
      <arg type="i" direction="in" name="y"/>
      <arg type="i" direction="in" name="width"/>
      <arg type="i" direction="in" name="height"/>
      <arg type="b" direction="in" name="fullscreen"/>
      <arg type="s" direction="out" name="result"/>
    </method>
  </interface>
</node>`;

function findMonitor(x, y, width, height) {
    const display = global.display;
    for (let i = 0; i < display.get_n_monitors(); i++) {
        const geometry = display.get_monitor_geometry(i);
        if (geometry.x === x && geometry.y === y &&
            geometry.width === width && geometry.height === height)
            return i;
    }
    return display.get_monitor_index_for_rect(new Mtk.Rectangle({x, y, width, height}));
}

function unmaximize(window) {
    // GNOME 49 replaced get_maximized() with is_maximized() and dropped the
    // flags argument from unmaximize().
    const maximized = typeof window.is_maximized === 'function'
        ? window.is_maximized()
        : window.get_maximized() !== 0;
    if (!maximized)
        return;
    try {
        window.unmaximize();
    } catch {
        window.unmaximize(Meta.MaximizeFlags.BOTH);
    }
}

class WindowHelperService {
    constructor(version) {
        this._version = version;
    }

    // The app compares this with its bundled copy's metadata.json "version".
    GetVersion() {
        return this._version;
    }

    PlaceWindow(titleToken, x, y, width, height, fullscreen) {
        if (!TOKEN_PATTERN.test(titleToken))
            return 'invalid-token';

        const window = global.display.list_all_windows()
            .find(w => w.get_title() === titleToken);
        if (!window)
            return 'not-found';

        const monitor = findMonitor(x, y, width, height);
        if (monitor < 0)
            return 'no-monitor';

        if (fullscreen) {
            window.move_to_monitor(monitor);
            if (!window.is_fullscreen())
                window.make_fullscreen();
        } else {
            if (window.is_fullscreen())
                window.unmake_fullscreen();
            unmaximize(window);
            window.move_to_monitor(monitor);
            window.move_resize_frame(true, x, y, width, height);
        }
        return 'placed';
    }
}

export default class RevelationWindowHelperExtension extends Extension {
    enable() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(INTERFACE_XML,
            new WindowHelperService(this.metadata.version ?? 0));
        this._dbus.export(Gio.DBus.session, OBJECT_PATH);
    }

    disable() {
        this._dbus?.unexport();
        this._dbus = null;
    }
}
