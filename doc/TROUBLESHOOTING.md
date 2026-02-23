# Wrapper Troubleshooting

---

## Table of Contents

* [Linux Wayland and X11](#troubleshooting-wayland-x11)
* [Reset Settings and Plugins](#troubleshooting-reset)
* [Open the Debug Log](#troubleshooting-debug-log)
* [Uninstall and Remove Local Data](#troubleshooting-uninstall)

---

<a id="troubleshooting-wayland-x11"></a>

## Linux Wayland and X11

On some Ubuntu/Wayland setups, Electron rendering works more reliably when forced to X11:

```bash
revelation-electron --ozone-platform=x11
```

---

If you launch from the desktop, you can use a `.desktop` entry like this:

```ini
[Desktop Entry]
Name=REVELation Snapshot Presenter
Exec=revelation-electron --ozone-platform=x11
Terminal=false
Type=Application
Categories=Utility;
```

---

<a id="troubleshooting-reset"></a>

## Reset Settings and Plugins

Use the built-in reset action:

1. Open the app.
2. Go to `Revelation` (or app menu on macOS).
3. Click `Reset All Settings and Plugins...`.
4. Confirm reset.

This resets local app settings and removes local overridden plugin/framework resources so the app can return to defaults.

---

<a id="troubleshooting-debug-log"></a>

## Open the Debug Log

From the app menu:

1. Open `Help`.
2. Open `Debug`.
3. Click `Open Log`.

---

The log file is stored in the app user-data folder as `debug.log`.

Common default user-data locations:

- Windows: `%APPDATA%/revelation-electron/`
- macOS: `~/Library/Application Support/revelation-electron/`
- Linux: `~/.config/revelation-electron/`

---

<a id="troubleshooting-uninstall"></a>

## Uninstall and Remove Local Data

If you want a full clean removal, do both:

1. Uninstall the app.
2. Remove local user data and caches.

---

### 1) Uninstall app

Typical install locations (vary by installer/package manager):

- Windows (NSIS): uninstall from Apps/Programs, usually installed under `C:\Program Files\REVELation Snapshot Presenter\`
- macOS: remove app from `/Applications`
- Linux (`.deb`/`.rpm`): remove package with your package manager

---

### 2) Remove local user data and caches

Remove the app user-data folder:

- Windows: `%APPDATA%/revelation-electron/`
- macOS: `~/Library/Application Support/revelation-electron/`
- Linux: `~/.config/revelation-electron/`

---

Optional: if you also want to remove your presentation library created by default, delete:

- `~/Documents/REVELation Presentations/`

Only delete that folder if you no longer need your local presentations and media.
