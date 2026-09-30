# Wrapper Troubleshooting

---

## Table of Contents

* [Linux Wayland and X11](#troubleshooting-wayland-x11)
* [Enable DevTools at Runtime](#troubleshooting-runtime-devtools)
* [Peering and mDNS Issues](#troubleshooting-peering-mdns)
* [Pairing Must Be Renewed After Update](#troubleshooting-peering-repair-after-update)
* [Peering Quick Checks](#troubleshooting-peering-quick-checks)
* [Manual Pairing by IP](#troubleshooting-peering-manual-pairing)
* [Paired but Z Does Nothing](#troubleshooting-peering-send-fail)
* [Firewall and Network Notes](#troubleshooting-peering-firewall)
* [Reset Settings and Plugins](#troubleshooting-reset)
* [Open the Debug Log](#troubleshooting-debug-log)
* [Uninstall and Remove Local Data](#troubleshooting-uninstall)

---

<a id="troubleshooting-wayland-x11"></a>

## Linux Wayland and X11

Wayland does not let applications position their own windows, so on a Wayland
session the presentation window opens on whichever monitor GNOME chooses (usually
the one under the mouse pointer), not your **Preferred Display**.

### GNOME window helper (recommended on Ubuntu/GNOME)

On GNOME, the app can install a small GNOME Shell extension that places
presentation, speaker notes and additional-screen windows on the chosen display
while keeping native Wayland rendering (full hardware acceleration).

1. Open **Settings → Screens** and click **Install GNOME Window Helper**.
2. Log out of GNOME and back in. GNOME only loads newly installed extensions at login.
3. Settings → Screens now shows *GNOME window helper active*.

Installing copies the extension to
`~/.local/share/gnome-shell/extensions/revelation-window-helper@pastordaniel.net/`,
adds it to GNOME's enabled extensions, and turns on GNOME's **Use Extensions**
switch if it was off.

Settings → Screens also shows three versions of the helper: **Running** (loaded
in GNOME Shell now), **Installed** (in your extensions folder) and **Bundled with
app**. When the app ships a newer version, click **Reinstall GNOME Window
Helper**, then log out and back in. GNOME keeps running the old copy until then.

**Remove GNOME Window Helper** turns the extension off, removes it from GNOME's
enabled extensions and deletes its folder. It leaves GNOME's **Use Extensions**
switch as it is, because other extensions may need it.

To check from a terminal:

```bash
# Installed version and state (ACTIVE, INACTIVE, ERROR, ...)
gnome-extensions info revelation-window-helper@pastordaniel.net

# Version actually running in GNOME Shell
gdbus call --session --dest org.gnome.Shell --object-path /org/revelation/WindowHelper \
  --method org.revelation.WindowHelper.GetVersion

# Errors from loading the extension
journalctl --user -b | grep -i revelation
```

The extension declares support for GNOME Shell 45–50. After a major GNOME
upgrade it may be disabled until an app update adds the new version. Until then,
use the X11 option below.

### KDE Plasma

On KDE Plasma under Wayland, nothing needs installing. For each window the app
loads a short-lived KWin script over D-Bus that moves the window to the chosen
display and then unloads itself. Settings → Screens shows *KDE Plasma detected*
when KWin scripting is reachable.

Tested on Plasma 6 (Fedora KDE). Plasma 5.27 (for example Kubuntu 24.04 in its
Wayland session) is supported by the same script but has not been tested yet.

If windows still open on the wrong display, check the app log for
`KWin window helper` lines, and KWin's own log for script errors:

```bash
journalctl --user -b | grep -i -E 'kwin|revelation'
```

### Forcing X11

If you are not on GNOME or KDE Plasma, or the helper is unavailable, you can force X11. This
restores window placement but loses some hardware acceleration, so video and
compositing can be less smooth, especially at 4K. On some Ubuntu/Wayland setups,
Electron rendering also works more reliably when forced to X11:

```bash
revelation-electron --ozone-platform=x11
```

### GPU errors on X11 (missing background video, GPU process crash)

If you see GPU errors like `gbm_bo_import` returning nullptr or `GPU process exited unexpectedly` in the console, the GPU driver is failing to share buffers with Chromium under XWayland. This also causes background videos in presentations to disappear.

Pass one of the following additional flags, from least to most aggressive:

```bash
# Option 1: Disable GPU sandbox only (least invasive)
revelation-electron --ozone-platform=x11 --disable-gpu-sandbox

# Option 2: Software GL renderer — bypasses GBM entirely (recommended)
revelation-electron --ozone-platform=x11 --use-gl=swiftshader

# Option 3: Disable GPU compositing
revelation-electron --ozone-platform=x11 --disable-gpu-compositing

# Option 4: Disable GPU entirely (most stable, no hardware acceleration)
revelation-electron --ozone-platform=x11 --disable-gpu
```

`--use-gl=swiftshader` (option 2) is the recommended starting point — it uses CPU-based software rendering to avoid the GBM crash while keeping compositing functional, which allows background videos to display correctly.

---

If you launch from the desktop, you can use a `.desktop` entry like this:

```ini
[Desktop Entry]
Name=REVELation Snapshot Presenter
Exec=revelation-electron --ozone-platform=x11 --use-gl=swiftshader
Terminal=false
Type=Application
Categories=Utility;
```

---

<a id="troubleshooting-runtime-devtools"></a>

## Enable Debug Mode

By default the app prints nothing to the console, does not write `debug.log`, and hides the **Help → Debug** menu. To turn these on, start the app with:

```bash
revelation-electron --enable-debug
```

or in development environment:

```bash
npm start -- --enable-debug
```

## Enable DevTools at Runtime

If you need to debug UI behavior in any app window, start the app with:

```bash
revelation-electron --enable-devtools
```

or in development environment:

```bash
npm start -- --enable-devtools
```

With this flag enabled, pressing `F12` in any `BrowserWindow` opens DevTools in a separate (detached) window.

---

<a id="troubleshooting-peering-mdns"></a>

## Peering and mDNS Issues

If peer control is not working, these are the most common causes:

- mDNS discovery blocked by firewall/network policy.
- Master is not actually publishing (`Networking` is not `network` mode).
- Follower is not allowed to browse peers (`mDNS Browse` disabled).
- Wrong host/port or pairing PIN when pairing manually.
- Peer command link not established yet (pressing `Z` appears to do nothing).
- Pairing was made before a security update and now needs renewing (see below).
- The master forgot this follower (see below).

---

<a id="troubleshooting-peering-repair-after-update"></a>

### "Pairing must be renewed" after updating

Version 1.0.11 changed how peers authenticate. Peer pairing now has its own
signing key, separate from the one used for WordPress publishing. The pairing PIN
is now used only once, when pairing, and after that the follower proves who it is
with its own key. **Pairings made before the update stop working and must be
renewed once.**

You will see one of these:

- In the follower's `Paired Masters` list: `Paired with an older version. Pair
  again to reconnect.`
- While pairing: `Master … is running an older, incompatible peering protocol.
  Update the app on the master and try again.`

To fix:

1. **Update both machines.** A follower on the new version cannot pair with a
   master on an older one, and it refuses on purpose rather than falling back.
2. On the follower, open `Peer Presenter Pairing...`, find the master under
   `Paired Masters`, and choose `Pair Again`.
3. Enter the master's current PIN.

Nothing else needs changing. The PIN, ports and mDNS settings are unaffected,
and existing WordPress pairings keep working.

---

<a id="troubleshooting-peering-forgotten"></a>

### "This master no longer recognizes this device"

The master was told to forget this follower (`Settings → Peer Pairing → Paired
Followers → Forget` on the master), or the master's list of followers was lost.
The follower stops trying to connect instead of retrying, so the master isn't
flooded with failed attempts.

To reconnect, choose `Pair Again` on the follower and enter the master's PIN.

Changing the PIN on the master does **not** cause this. Followers that are
already paired keep working after a PIN change. Only new pairings need the new
PIN.

---

<a id="troubleshooting-peering-quick-checks"></a>

### Quick checks first

On the machine that should act as the master:

1. Open `Settings...`.
2. Set `Networking` to `network`.
3. Enable `Enable Master Mode (mDNS Publish and Peering Endpoints)`.
4. Verify `Vite Server Port` (default is commonly `8000`).
5. Confirm the `Pairing PIN`.

On the machine that should act as the follower:

1. Open `Settings...`.
2. Enable `Enable Peering as Follower (mDNS Browse)`.
3. Confirm it can reach the master machine on the same LAN/subnet.

Then open `Peer Presenter Pairing...` and verify the master appears in `Discovered Peers`.

---

<a id="troubleshooting-peering-manual-pairing"></a>

### When mDNS discovery is broken

Some environments block multicast/broadcast discovery (guest Wi-Fi, VLANs, strict firewalls, managed corporate networks).  
If discovery does not work, use manual pairing by IP:

1. Open `Peer Presenter Pairing...` on the follower.
2. Click `Manual Pairing...`.
3. In `Pair by IP Address`, enter the master IP (example `192.168.1.50`).
4. Enter `Pairing Port` (usually the master's `Vite Server Port`, commonly `8000`).
5. Click `Pair` and enter the master's `Pairing PIN`.

If this succeeds, mDNS can remain unreliable; manual pairing still works as a fallback.

---

<a id="troubleshooting-peering-send-fail"></a>

### If pairing works but send-to-peer does not

If peers are paired but pressing `Z` does nothing:

1. Start a presentation on the master first.
2. Ensure Reveal Remote is available/initialized in that session.
3. Press `Z` again, or use presentation context menu `Send Presentation to Peers (z)`.
4. Check `Peer Presenter Pairing...` for currently paired masters and host/port hints.

Also verify both machines are still on the same reachable network and no host firewall rule changed mid-session.

---

<a id="troubleshooting-peering-firewall"></a>

### Firewall and network notes

- mDNS uses multicast DNS on local networks and is commonly blocked by firewall policies.
- Peer pairing/commands require TCP connectivity to the master's `Vite Server Port` (often `8000`).
- If you're using routed/VLAN networks, expect discovery to fail and prefer manual pairing by IP.

---

### Where to go next

- Full protocol and architecture details: [doc/dev/PEERING.md](dev/PEERING.md)
- Multi-language variant peer workflow: [revelation/doc/VARIANTS_REFERENCE.md](../revelation/doc/VARIANTS_REFERENCE.md)

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
